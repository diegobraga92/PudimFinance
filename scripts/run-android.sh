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
VERIFY_ACTION=""
VERIFY_STALE_REFS=false
ALLOW_STALE=false
BUILD=true
KEEP_RUNNING=false
BACKEND_PID=""
BACKEND_STARTED=false
EMULATOR_PID=""
EMULATOR_STARTED=false
DEVICE_SERIAL=""
# Evidence captured by post_test_notification for the verification step.
SMOKE_NOTIFICATION_DUMP=""
SMOKE_CAPTURE_ID=""

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
  --smoke          Post a synthetic financial notification, tap its Credit
                   quick action, and assert the tap is never lost (it must
                   create the transaction or stay on Pending review). Fails the
                   run otherwise. Implies --verify-action=credit.
  --verify-action[=income|debit|credit]
                   Post the synthetic notification and tap that quick action
                   instead of just asserting the prompt exists (default: credit).
                   Requires a signed-in session with notification capture on.
  --verify-stale-refs
                   Seed a capture category id this server does not have (what a
                   restored database or a server switch leaves behind), tap
                   Credit, and assert the capture is still stored — uncategorized
                   with a warning — instead of being rejected and dropped.
  --no-build       Reuse the newest existing debug APK. Refuses to install an
                   APK older than the sources it was built from unless
                   --allow-stale is passed (a stale APK silently hides fixes).
  --allow-stale    With --no-build, install the existing APK even when it
                   predates the current sources.
  --no-emulator    Use an already-connected device/emulator.
  --no-db          If the backend is not already healthy, start run.sh with
                   --no-db rather than starting Docker PostgreSQL.
  --keep           Leave processes started by this script running on exit.
  --help           Show this help and exit.

Environment:
  PUDIM_ANDROID_AVD             AVD name (default: Pixel_9_API_36)
  PUDIM_ANDROID_SERIAL          Device to target when several are connected
                                (an emulator is preferred automatically)
  PUDIM_HOST_BACKEND_URL        Host health URL (default: http://localhost:3000)
  PUDIM_EMULATOR_BACKEND_URL    URL embedded in the app (default: http://10.0.2.2:3000)
  PUDIM_ANDROID_BOOT_TIMEOUT    Boot timeout in seconds (default: 120)
EOF
}

for arg in "$@"; do
    case "$arg" in
        --smoke)        SMOKE=true ;;
        --verify-action) VERIFY_ACTION=credit ;;
        --verify-action=*) VERIFY_ACTION="${arg#*=}" ;;
        --verify-stale-refs) VERIFY_STALE_REFS=true ;;
        --allow-stale)  ALLOW_STALE=true ;;
        --no-build)     BUILD=false ;;
        --no-emulator)  NO_EMULATOR=true ;;
        --no-db)        NO_DB=true ;;
        --keep)         KEEP_RUNNING=true ;;
        --help)         usage; exit 0 ;;
        *)              log_error "Unknown argument: $arg"; usage >&2; exit 2 ;;
    esac
done

if [ -z "$VERIFY_ACTION" ] && [ "$SMOKE" = true ]; then
    VERIFY_ACTION=credit
fi
case "$VERIFY_ACTION" in
    "" | income | debit | credit) ;;
    *) log_error "--verify-action must be one of: income, debit, credit (got '$VERIFY_ACTION')."; exit 2 ;;
esac

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

# Picks the device to install/verify against.
#
# Prefers an emulator when both an emulator and a real device are attached: the
# debug APK only carries the emulator ABIs, and a plugged-in phone used to be
# targeted by accident (INSTALL_FAILED_NO_MATCHING_ABIS at best). Set
# PUDIM_ANDROID_SERIAL to choose a device explicitly.
connected_device() {
    if [ -n "${PUDIM_ANDROID_SERIAL:-}" ]; then
        printf '%s' "$PUDIM_ANDROID_SERIAL"
        return
    fi
    local serials emulator
    serials="$("$ADB" devices | awk '$2 == "device" { print $1 }')"
    emulator="$(printf '%s\n' "$serials" | grep -E '^emulator-' | head -1 || true)"
    if [ -n "$emulator" ]; then
        printf '%s' "$emulator"
        return
    fi
    printf '%s' "$(printf '%s\n' "$serials" | head -1)"
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
        if ! printf '%s' "$DEVICE_SERIAL" | grep -qE '^emulator-'; then
            log_warn "$DEVICE_SERIAL looks like a physical device; this debug APK only carries emulator ABIs."
            log_warn "Set PUDIM_ANDROID_SERIAL to target something else."
        fi
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
    # `--no-build` reused an APK that predated the plugin sources once, which
    # made hardened capture code look broken. Fail loudly instead.
    assert_apk_is_current() {
        local apk="$1"
        [ "$ALLOW_STALE" = true ] && return 0
        local newest
        newest="$(find \
            "$DESKTOP_DIR/src" \
            "$DESKTOP_DIR/src-tauri/src" \
            "$DESKTOP_DIR/src-tauri/plugins" \
            "$DESKTOP_DIR/src-tauri/gen/android/app/src" \
            "$ROOT_DIR/shared" \
            \( -name node_modules -o -name build -o -name target -o -name dist -o -name .gradle \) -prune -o \
            -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.rs' -o -name '*.kt' \) \
            -newer "$apk" -print -quit 2>/dev/null || true)"
        if [ -n "$newest" ]; then
            log_error "Refusing to install a stale APK: $(basename "$apk") predates $newest"
            log_error "Rebuild (drop --no-build) or pass --allow-stale to install it anyway."
            exit 1
        fi
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
    assert_apk_is_current "$apk"
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

# The capture prompt is tagged with the capture id (see CapturePromptNotifier.show),
# so a tap can be correlated with the receiver and the native journal.
capture_id_from_dump() {
    grep -E 'pkg=com\.pudimfinance\.app' "$1" 2>/dev/null |
        grep -oE 'tag=cap-[0-9]+-[0-9a-z]+' | head -1 | sed 's/^tag=//'
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
    local capture_id=""
    for attempt in $(seq 1 10); do
        "$ADB" -s "$DEVICE_SERIAL" shell dumpsys notification --noredact >"$notification_dump" 2>/dev/null || true
        "$ADB" -s "$DEVICE_SERIAL" logcat -d -s PudimSyncWorker:I '*:S' >"$worker_log" 2>/dev/null || true
        # A live prompt is a NotificationRecord tagged with the capture id. The
        # channel definition ("mName=Transaction detected") and older synthetic
        # notifications are present even with no prompt, which used to make this
        # check pass against a stale dump.
        capture_id="$(capture_id_from_dump "$notification_dump" || true)"
        if [ -n "$capture_id" ] ||
            grep -Eq "Batch answered: [1-9][0-9]* settled|Retrying [1-9][0-9]* operation|rejected" "$worker_log"; then
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
    SMOKE_NOTIFICATION_DUMP="$notification_dump"
    SMOKE_CAPTURE_ID="$(capture_id_from_dump "$notification_dump" || true)"
    if [ -n "$SMOKE_CAPTURE_ID" ]; then
        log_ok "Synthetic notification produced capture evidence (capture $SMOKE_CAPTURE_ID)."
    else
        log_ok "Synthetic notification produced capture evidence."
    fi
}

# --- quick-action verification ---------------------------------------------

action_label_for() {
    case "$1" in
        income) printf 'Income' ;;
        debit)  printf 'Debit' ;;
        credit) printf 'Credit' ;;
    esac
}

# Reads the action button bounds out of a uiautomator dump of the shade.
action_bounds_from_dump() {
    local dump_file="$1" label="$2"
    tr '<' '\n' <"$dump_file" 2>/dev/null |
        grep -E "text=\"$label\"" |
        grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' |
        head -1
}

# "[501,908][662,1034]" -> "581 971"
center_of_bounds() {
    local coords
    coords="$(printf '%s' "$1" | grep -oE '[0-9]+' | tr '\n' ' ')"
    # shellcheck disable=SC2086
    set -- $coords
    printf '%s %s' "$(( (${1:-0} + ${3:-0}) / 2 ))" "$(( (${2:-0} + ${4:-0}) / 2 ))"
}

# The tap journal is the durable hand-off between the receiver and the WebView.
journal_actions() {
    "$ADB" -s "$DEVICE_SERIAL" shell run-as "$PACKAGE_NAME" \
        cat shared_prefs/pudim_capture_actions.xml 2>/dev/null || true
}

# Taps a real Income/Debit/Credit button and asserts the capture is never lost:
# the native import uploaded it, or the app applied and acknowledged the journal.
verify_capture_action() {
    local kind="$1"
    local label
    label="$(action_label_for "$kind")"
    local dump_file="$SMOKE_NOTIFICATION_DUMP"
    local capture_id="$SMOKE_CAPTURE_ID"
    local stamp
    stamp="$(date +%s)"
    local tap_dump="/tmp/pudim-action-${kind}-${stamp}.xml"
    local action_log="/tmp/pudim-action-${kind}-${stamp}.log"

    if [ -z "$dump_file" ] || [ ! -f "$dump_file" ]; then
        log_error "--verify-action needs the synthetic-notification evidence; run --smoke first."
        return 1
    fi
    if [ -z "$capture_id" ]; then
        log_error "No Pudim capture prompt was found in $dump_file."
        log_error "Sign in and enable notification capture before asserting a quick action."
        return 1
    fi
    log_info "Verifying the '$label' quick action for capture $capture_id..."

    # Each action is a real PendingIntent broadcast into CaptureActionReceiver, so
    # tapping the actual button is the only faithful check.
    "$ADB" -s "$DEVICE_SERIAL" shell cmd statusbar expand-notifications >/dev/null 2>&1 || true
    sleep 2
    local bounds=""
    for _ in $(seq 1 5); do
        "$ADB" -s "$DEVICE_SERIAL" shell uiautomator dump /sdcard/pudim-action.xml >/dev/null 2>&1 || true
        "$ADB" -s "$DEVICE_SERIAL" shell cat /sdcard/pudim-action.xml >"$tap_dump" 2>/dev/null || true
        bounds="$(action_bounds_from_dump "$tap_dump" "$label" || true)"
        [ -n "$bounds" ] && break
        sleep 1
    done
    if [ -z "$bounds" ]; then
        log_error "Could not find the '$label' button on the Pudim capture prompt."
        log_error "UI dump: $tap_dump"
        return 1
    fi

    local tap_x tap_y
    read -r tap_x tap_y <<<"$(center_of_bounds "$bounds")"
    log_info "Tapping '$label' at ($tap_x, $tap_y) [$bounds]..."
    "$ADB" -s "$DEVICE_SERIAL" shell input tap "$tap_x" "$tap_y"
    # Close the shade only after the tap; collapsing first taps the launcher.
    sleep 2
    "$ADB" -s "$DEVICE_SERIAL" shell cmd statusbar collapse >/dev/null 2>&1 || true

    local tap_seen=false
    for _ in $(seq 1 10); do
        "$ADB" -s "$DEVICE_SERIAL" logcat -d \
            -s PudimCapture:I PudimSyncWorker:I AndroidRuntime:E '*:S' >"$action_log" 2>/dev/null || true
        if grep -Fq "action=$kind capture=$capture_id" "$action_log"; then
            tap_seen=true
            break
        fi
        sleep 1
    done
    if grep -qE 'FATAL EXCEPTION|Process: com\.pudimfinance\.app' "$action_log"; then
        log_error "The app crashed while handling the '$label' tap."
        cat "$action_log" >&2
        return 1
    fi
    if [ "$tap_seen" != true ]; then
        log_error "The '$label' tap never reached CaptureActionReceiver (no PudimCapture line)."
        log_error "Log: $action_log"
        return 1
    fi
    log_ok "The '$label' tap reached the capture receiver."

    # A rejected operation must never be swallowed. The field bug had the worker
    # acknowledge an operation the server refused ("Failed to resolve posting
    # account"), so the capture existed nowhere: no server row, no review item,
    # only a warning line. Any rejection fails the run.
    if grep -qE 'rejected|failed permanently|Failed to resolve posting account' "$action_log"; then
        log_error "The server rejected the captured transaction; it was not stored."
        grep -E 'rejected|failed permanently|Failed to resolve posting account' "$action_log" | tail -5 >&2
        log_error "Log: $action_log"
        return 1
    fi

    # Durability: the worker stored it, or the journal kept it for the WebView.
    local journal
    journal="$(journal_actions)"
    local journaled=false
    if grep -Eq 'Batch answered: [1-9][0-9]* settled' "$action_log"; then
        log_ok "The native worker stored the captured transaction."
        if printf '%s' "$journal" | grep -q 'capture_id'; then
            journaled=true
        fi
    elif printf '%s' "$journal" | grep -q 'capture_id'; then
        log_ok "The tap was journaled in pudim_capture_actions.xml."
        journaled=true
    elif [ -z "$journal" ]; then
        log_warn "pudim_capture_actions.xml is unreadable (release build?); skipping journal assertions."
        return 0
    else
        log_warn "No upload and no journal entry seen; the capture should still be on Pending review."
        log_warn "Journal: $journal"
    fi
    if [ "$journaled" != true ]; then
        log_warn "Nothing was journaled for the WebView; skipping the drain assertion."
        return 0
    fi

    # Regression guard: the app must consume the journal on the next launch
    # instead of leaving the tap stranded ("nowhere to be found").
    log_info "Relaunching the app to confirm the journaled capture is applied..."
    "$ADB" -s "$DEVICE_SERIAL" shell am start -n "$PACKAGE_NAME/.MainActivity" >/dev/null 2>&1 || true
    local drained=false
    for _ in $(seq 1 15); do
        journal="$(journal_actions)"
        if ! printf '%s' "$journal" | grep -q 'capture_id'; then
            drained=true
            break
        fi
        sleep 1
    done
    if [ "$drained" != true ]; then
        log_error "The app relaunched but never applied the journaled capture."
        log_error "Journal: $journal"
        log_error "Check Settings -> Logs for 'peeked'/'native import' entries."
        return 1
    fi
    log_ok "The app applied and acknowledged the journaled capture."
}

# --- stale capture reference verification -----------------------------------

CAPTURE_SETTINGS_PREFS="shared_prefs/pudim_capture_settings.xml"
STALE_CAPTURE_CATEGORY="11111111-2222-4333-8444-555555555555"

capture_settings_read() {
    "$ADB" -s "$DEVICE_SERIAL" shell run-as "$PACKAGE_NAME" cat "$CAPTURE_SETTINGS_PREFS" 2>/dev/null || true
}

# Writes the mirrored capture settings back (debug builds only). `run-as sh -c`
# does not inherit the app data dir, so the path must be absolute.
capture_settings_write() {
    local path="/data/data/$PACKAGE_NAME/$CAPTURE_SETTINGS_PREFS"
    printf '%s' "$1" | "$ADB" -s "$DEVICE_SERIAL" shell \
        "run-as $PACKAGE_NAME sh -c 'cat > $path'"
}

# Points the mirrored default category at an id this server does not know.
capture_settings_with_stale_category() {
    local xml="$1"
    if printf '%s' "$xml" | grep -q 'name="default_category_id"'; then
        printf '%s' "$xml" | sed -E \
            "s|<string name=\"default_category_id\">[^<]*</string>|<string name=\"default_category_id\">$STALE_CAPTURE_CATEGORY</string>|"
    else
        printf '%s' "$xml" | sed -E \
            "s|</map>|<string name=\"default_category_id\">$STALE_CAPTURE_CATEGORY</string></map>|"
    fi
}

# A capture settings mirror the server cannot resolve (restored database, or the
# app pointed at another server) used to be an invisible data-loss path: the
# server rejected every import and the worker deleted the operation, so the
# capture existed nowhere. It must now be stored without the category, with the
# downgrade reported by the worker.
verify_stale_capture_reference() {
    local original
    original="$(capture_settings_read)"
    if [ -z "$original" ]; then
        log_warn "Native capture settings are unreadable (release build?); skipping --verify-stale-refs."
        return 0
    fi

    # SharedPreferences are cached in memory, so patch the file while stopped.
    "$ADB" -s "$DEVICE_SERIAL" shell am force-stop "$PACKAGE_NAME" >/dev/null 2>&1 || true
    sleep 1
    capture_settings_write "$(capture_settings_with_stale_category "$original")"
    if ! capture_settings_read | grep -q "$STALE_CAPTURE_CATEGORY"; then
        log_error "Could not seed the stale category id into the native capture settings."
        return 1
    fi
    log_info "Seeded category $STALE_CAPTURE_CATEGORY (absent here); the capture must still be stored."

    # The listener restarts for the synthetic notification with the app stopped,
    # which is exactly the closed-app import path that failed in the field.
    if ! post_test_notification; then
        capture_settings_write "$original"
        return 1
    fi
    local status=0
    verify_capture_action credit || status=1

    if "$ADB" -s "$DEVICE_SERIAL" logcat -d \
        -s PudimSyncWorker:I '*:S' 2>/dev/null | grep -q 'stored with a warning'; then
        log_ok "The server stored the capture without the missing category and said so."
    else
        log_warn "No 'stored with a warning' line in the worker log; the downgrade was not reported."
    fi

    # Leave the device as it was found so later runs use the real category.
    "$ADB" -s "$DEVICE_SERIAL" shell am force-stop "$PACKAGE_NAME" >/dev/null 2>&1 || true
    sleep 1
    capture_settings_write "$original"
    log_info "Restored the previous capture settings."

    return "$status"
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
  1. automated: re-run with --verify-action=credit (or income/debit); --smoke
     implies it. The runner posts the synthetic notification, taps the real
     button through uiautomator, then asserts the tap was not lost.
  2. manual: post the synthetic notification above and tap Credit yourself
  3. watch the worker, the capture decisions, and any crash:
       $ADB -s $DEVICE_SERIAL logcat -s PudimCapture:I PudimSyncWorker:I AndroidRuntime:E
  4. inspect what the tap journaled (debug builds only):
       $ADB -s $DEVICE_SERIAL shell run-as $PACKAGE_NAME cat shared_prefs/pudim_capture_actions.xml
       items present -> the tap is waiting for the WebView to apply it
       items empty   -> the app applied and acknowledged every tap
       pudim_native_sync_outbox.xml  -> the transaction is queued for upload
  5. in the app, Settings -> Logs (or the Server screen shortcut) shows the same
     trail merged with the WebView/API/sync entries; this also works on release
     builds, where logcat and `run-as` are unavailable.
  The tap must always either create the transaction or keep the capture on the
  Pending review screen; if neither happens, the run is a regression.

The app must be signed in and notification capture enabled before the
synthetic notification can create a transaction.
EOF

if [ "$VERIFY_STALE_REFS" = true ]; then
    verify_stale_capture_reference
elif [ -n "$VERIFY_ACTION" ]; then
    post_test_notification
    verify_capture_action "$VERIFY_ACTION"
elif [ "$SMOKE" = true ]; then
    post_test_notification
fi

if [ "$KEEP_RUNNING" = false ]; then
    log_info "Runner finished; stopping only processes it started."
else
    log_ok "Keeping emulator/backend alive (--keep). Press Ctrl+C to stop this runner."
    while true; do sleep 3600; done
fi