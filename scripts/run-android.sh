#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/desktop"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator"
AVD_NAME="${PUDIM_ANDROID_AVD:-Pixel_9_API_36}"
PACKAGE_NAME="com.pudimfinance.app"
NOTIFICATION_SERVICE="${PACKAGE_NAME}/app.tauri.pudimnative.NotificationListenerService"
HOST_BACKEND_URL="${PUDIM_HOST_BACKEND_URL:-http://localhost:3000}"
EMULATOR_BACKEND_URL="${PUDIM_EMULATOR_BACKEND_URL:-http://10.0.2.2:3000}"
BOOT_TIMEOUT="${PUDIM_ANDROID_BOOT_TIMEOUT:-120}"

NO_EMULATOR=false
NO_DB=false
SMOKE=false
BUILD=true
KEEP_RUNNING=false
BACKEND_PID=""
BACKEND_STARTED=false
EMULATOR_PID=""
EMULATOR_STARTED=false
DEVICE_SERIAL=""

log_info() { printf '\033[0;36m[android]\033[0m %s\n' "$1"; }
log_ok() { printf '\033[0;32m[android]\033[0m %s\n' "$1"; }
log_warn() { printf '\033[1;33m[android]\033[0m %s\n' "$1"; }
log_error() { printf '\033[0;31m[android]\033[0m %s\n' "$1" >&2; }

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Build, install, and launch the PudimFinance Android app on the local emulator.
The runner uses the host backend through Android emulator loopback
(http://10.0.2.2:3000) and does not reset the database.

Options:
  --smoke          Post a synthetic financial notification after launch and
                   print native capture/log evidence. App setup/auth is not
                   automated, so transaction assertions require configured
                   capture settings and a signed-in session.
  --no-build       Reuse the newest existing x86_64 debug APK.
  --no-emulator    Use an already-connected device/emulator.
  --no-db          If the backend is not already healthy, start run.sh with
                   --no-db rather than starting Docker PostgreSQL.
  --keep           Leave processes started by this script running on exit.
  --help           Show this help and exit.

Environment:
  PUDIM_ANDROID_AVD             AVD name (default: Pixel_9_API_36)
  PUDIM_HOST_BACKEND_URL        Host health URL (default: http://localhost:3000)
  PUDIM_EMULATOR_BACKEND_URL    URL embedded in the app (default: http://10.0.2.2:3000)
  PUDIM_ANDROID_BOOT_TIMEOUT    Boot timeout in seconds (default: 120)
EOF
}

for arg in "$@"; do
    case "$arg" in
        --smoke)        SMOKE=true ;;
        --no-build)     BUILD=false ;;
        --no-emulator)  NO_EMULATOR=true ;;
        --no-db)        NO_DB=true ;;
        --keep)         KEEP_RUNNING=true ;;
        --help)         usage; exit 0 ;;
        *)              log_error "Unknown argument: $arg"; usage >&2; exit 2 ;;
    esac
done

cleanup() {
    if [ "$KEEP_RUNNING" = true ]; then
        return 0
    fi

    if [ "$EMULATOR_STARTED" = true ] && [ -n "$DEVICE_SERIAL" ]; then
        log_info "Stopping emulator $DEVICE_SERIAL..."
        "$ADB" -s "$DEVICE_SERIAL" emu kill >/dev/null 2>&1 || true
    fi
    if [ "$EMULATOR_STARTED" = true ] && [ -n "$EMULATOR_PID" ]; then
        kill "$EMULATOR_PID" >/dev/null 2>&1 || true
    fi
    if [ "$BACKEND_STARTED" = true ] && [ -n "$BACKEND_PID" ]; then
        log_info "Stopping backend started by this script..."
        kill "$BACKEND_PID" >/dev/null 2>&1 || true
        wait "$BACKEND_PID" >/dev/null 2>&1 || true
    fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_tools() {
    local missing=()
    command -v curl >/dev/null 2>&1 || missing+=(curl)
    command -v npm >/dev/null 2>&1 || missing+=(npm)
    [ -x "$ADB" ] || missing+=("$ADB")
    [ -x "$EMULATOR" ] || missing+=("$EMULATOR")
    if [ "${#missing[@]}" -gt 0 ]; then
        log_error "Missing required tools: ${missing[*]}"
        exit 1
    fi
}

backend_healthy() {
    curl -fsS --max-time 3 "$HOST_BACKEND_URL/health" >/dev/null 2>&1
}

start_backend_if_needed() {
    if backend_healthy; then
        log_ok "Backend already healthy at $HOST_BACKEND_URL."
        return
    fi

    log_info "Backend is not healthy; starting scripts/run.sh..."
    if [ "$NO_DB" = true ]; then
        "$ROOT_DIR/scripts/run.sh" --no-db &
    else
        "$ROOT_DIR/scripts/run.sh" &
    fi
    BACKEND_PID=$!
    BACKEND_STARTED=true

    local elapsed=0
    until backend_healthy; do
        if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
            log_error "Backend runner exited before becoming healthy."
            exit 1
        fi
        if [ "$elapsed" -ge 60 ]; then
            log_error "Backend did not become healthy within 60 seconds."
            exit 1
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    log_ok "Backend is healthy."
}

connected_device() {
    "$ADB" devices | awk '$2 == "device" { print $1; exit }'
}

wait_for_boot() {
    local elapsed=0
    log_info "Waiting for Android boot (timeout: ${BOOT_TIMEOUT}s)..."
    "$ADB" -s "$DEVICE_SERIAL" wait-for-device >/dev/null
    until [ "$("$ADB" -s "$DEVICE_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')" = "1" ]; do
        if [ "$elapsed" -ge "$BOOT_TIMEOUT" ]; then
            log_error "Emulator did not boot within ${BOOT_TIMEOUT}s."
            exit 1
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    "$ADB" -s "$DEVICE_SERIAL" shell input keyevent 82 >/dev/null 2>&1 || true
    log_ok "Android boot completed on $DEVICE_SERIAL."
}

start_emulator_if_needed() {
    if [ "$NO_EMULATOR" = true ]; then
        DEVICE_SERIAL="$(connected_device)"
        [ -n "$DEVICE_SERIAL" ] || { log_error "--no-emulator requires a connected device."; exit 1; }
        wait_for_boot
        return
    fi

    DEVICE_SERIAL="$(connected_device)"
    if [ -n "$DEVICE_SERIAL" ]; then
        log_ok "Using already-connected device/emulator $DEVICE_SERIAL."
        wait_for_boot
        return
    fi

    if ! "$EMULATOR" -list-avds | grep -Fxq "$AVD_NAME"; then
        log_error "AVD '$AVD_NAME' was not found. Available AVDs:"
        "$EMULATOR" -list-avds >&2
        exit 1
    fi

    log_info "Starting AVD $AVD_NAME..."
    "$EMULATOR" -avd "$AVD_NAME" -no-audio -gpu swiftshader_indirect >/tmp/pudimfinance-emulator.log 2>&1 &
    EMULATOR_PID=$!
    EMULATOR_STARTED=true
    DEVICE_SERIAL="emulator-5554"
    wait_for_boot
}

build_and_install() {
    local apk
    find_debug_apk() {
        find "$DESKTOP_DIR/src-tauri/gen/android/app/build/outputs/apk" \
            \( -path '*/x86_64/debug/*.apk' -o -path '*/universal/debug/*.apk' \) \
            -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-
    }
    if [ "$BUILD" = true ]; then
        log_info "Building x86_64 debug APK through Tauri..."
        (
            cd "$DESKTOP_DIR"
            VITE_API_BASE_URL="$EMULATOR_BACKEND_URL" npm run tauri android build -- --debug --target x86_64 --apk
        )
        apk="$(find_debug_apk || true)"
    else
        apk="$(find_debug_apk || true)"
    fi
    [ -n "$apk" ] && [ -f "$apk" ] || { log_error "No x86_64 debug APK found."; exit 1; }
    log_info "Installing $apk..."
    "$ADB" -s "$DEVICE_SERIAL" install -r -d "$apk" >/dev/null
    log_ok "APK installed."
}

configure_android_access() {
    "$ADB" -s "$DEVICE_SERIAL" shell pm grant "$PACKAGE_NAME" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true
    "$ADB" -s "$DEVICE_SERIAL" shell cmd notification allow_listener "$NOTIFICATION_SERVICE" >/dev/null 2>&1 || \
        log_warn "Could not grant notification access automatically; enable it in Android Settings."
    "$ADB" -s "$DEVICE_SERIAL" shell am force-stop "$PACKAGE_NAME" >/dev/null 2>&1 || true
    "$ADB" -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE_NAME/.MainActivity" >/dev/null
    log_ok "App launched."
}

post_test_notification() {
    local id="pudim-smoke-$(date +%s)"
    local notification_text="Compra aprovada de R\$ 23,50 em PADARIA DO ZE"
    local notification_dump="/tmp/${id}-notifications.txt"
    local worker_log="/tmp/${id}-worker.log"
    log_info "Posting synthetic financial notification ($id)..."
    # Exercise the NotificationListenerService rather than the foreground
    # WebView bridge. The listener is expected to survive the app process being
    # stopped after notification access has been granted.
    "$ADB" -s "$DEVICE_SERIAL" logcat -c >/dev/null 2>&1 || true
    "$ADB" -s "$DEVICE_SERIAL" shell am force-stop "$PACKAGE_NAME" >/dev/null 2>&1 || true
    local listener_ready=false
    for attempt in $(seq 1 15); do
        if "$ADB" -s "$DEVICE_SERIAL" logcat -d -v brief | grep -Fq \
            "notification listener service connected: ComponentInfo{$NOTIFICATION_SERVICE}"; then
            listener_ready=true
            break
        fi
        sleep 1
    done
    if [ "$listener_ready" != true ]; then
        log_error "NotificationListenerService did not reconnect after stopping the app."
        return 1
    fi
    # `adb shell` executes a remote shell; pass the complete command as one
    # quoted argument so spaces in the synthetic notification body are not
    # truncated to the first word by older platform-tools/emulator images.
    "$ADB" -s "$DEVICE_SERIAL" shell \
        "cmd notification post -S bigtext -t Nubank '$id' '$notification_text'" >/dev/null
    log_info "Recent Pudim notification/capture evidence:"
    local found=false
    for attempt in $(seq 1 10); do
        "$ADB" -s "$DEVICE_SERIAL" shell dumpsys notification --noredact >"$notification_dump" 2>/dev/null || true
        "$ADB" -s "$DEVICE_SERIAL" logcat -d -s PudimSyncWorker:I '*:S' >"$worker_log" 2>/dev/null || true
        if (grep -Eiq "transaction detected" "$notification_dump" &&
            grep -Eq "23,50|PADARIA DO ZE" "$notification_dump") ||
            grep -Eq "Applied [1-9][0-9]* operation|Recorded permanent batch failure for [1-9][0-9]* operation|Retrying [1-9][0-9]* operation" "$worker_log"; then
            found=true
            break
        fi
        sleep 1
    done
    grep -E "${id}|Transaction detected|pudim_capture_prompt" "$notification_dump" | tail -20 || true
    log_info "Native worker log evidence:"
    tail -20 "$worker_log" || true
    if [ "$found" != true ]; then
        log_error "Synthetic notification produced no capture prompt or native worker evidence."
        log_error "Notification dump: $notification_dump"
        log_error "Worker log: $worker_log"
        return 1
    fi
    log_ok "Synthetic notification produced capture evidence."
}

require_tools
start_backend_if_needed
start_emulator_if_needed
build_and_install
configure_android_access

cat <<EOF

$(printf '\033[0;32m[android]\033[0m') Android app is ready.
  Backend URL in app: $EMULATOR_BACKEND_URL
  Device:             $DEVICE_SERIAL
  Package:            $PACKAGE_NAME

Useful commands:
  $ADB -s $DEVICE_SERIAL logcat -s PudimSyncWorker:I '*:S'
  $ADB -s $DEVICE_SERIAL shell dumpsys notification --noredact
  $ADB -s $DEVICE_SERIAL shell "cmd notification post -S bigtext -t Nubank test-1 'Compra aprovada de R\$ 23,50 em PADARIA DO ZE'"

Verifying the prompt actions (Income / Debit / Credit):
  1. post the synthetic notification above and tap Credit on the Pudim prompt
  2. watch the worker, the capture decisions, and any crash:
       $ADB -s $DEVICE_SERIAL logcat -s PudimCapture:I PudimSyncWorker:I AndroidRuntime:E
  3. inspect what the tap journaled (debug builds only):
       $ADB -s $DEVICE_SERIAL shell run-as $PACKAGE_NAME ls shared_prefs
       pudim_capture_actions.xml     -> the tap was drained by the app
       pudim_native_sync_outbox.xml  -> the transaction is queued for upload
  4. in the app, Settings -> Logs (or the Server screen shortcut) shows the same
     trail merged with the WebView/API/sync entries; this also works on release
     builds, where logcat and `run-as` are unavailable.
  The tap must always either create the transaction or keep the capture on the
  Pending review screen; if neither happens, the run is a regression.

The app must be signed in and notification capture enabled before the
synthetic notification can create a transaction.
EOF

if [ "$SMOKE" = true ]; then
    post_test_notification
fi

if [ "$KEEP_RUNNING" = false ]; then
    log_info "Runner finished; stopping only processes it started."
else
    log_ok "Keeping emulator/backend alive (--keep). Press Ctrl+C to stop this runner."
    while true; do sleep 3600; done
fi