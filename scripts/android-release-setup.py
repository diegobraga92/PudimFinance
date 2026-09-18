#!/usr/bin/env python3
"""Prepare the CI-generated Tauri Android project for release builds.

`desktop/src-tauri/gen/` is gitignored and re-created on every CI run by
`tauri android init`, so neither the signing configuration documented at
<https://v2.tauri.app/distribute/sign/android/> nor the cleartext-HTTP
permission can be committed. This script runs between `tauri android init` and
`tauri android build` and:

1. writes `gen/android/keystore.properties` (alias, passwords, absolute store
   path) when a keystore secret is set;
2. injects the matching `signingConfigs`/`signingConfig` Kotlin into
   `gen/android/app/build.gradle.kts`. The release build type falls back to the
   debug keystore when `keystore.properties` is absent, so a build without the
   secret still yields an installable (debug-signed) APK instead of an unsigned
   one;
3. allows cleartext HTTP in release builds. The tauri-cli template sets
   ``android:usesCleartextTraffic="false"`` for release (only debug allows it),
   so Android blocks every ``http://<lan-ip>:3000`` call this self-hosted client
   is built to make and the app reports "Could not reach the server". Set
   ``PUDIM_ALLOW_CLEARTEXT=false`` to keep Android's secure default, in which
   case only ``https://`` servers can be reached.
4. leaves Google sign-in to Android Credential Manager. The old browser-based
   custom-scheme redirect is intentionally not injected because Google blocks
   that flow for Android OAuth clients.
5. aligns the generated project's Kotlin Gradle plugin to 2.1.20, which is
   required to compile the Credential Manager dependencies' Kotlin metadata.

Accepted secret names (first one set wins, so the legacy Expo secrets keep
working):

- keystore: ``ANDROID_KEYSTORE_BASE64`` / ``ANDROID_KEY_BASE64`` / ``RELEASE_KEYSTORE_BASE64``
- alias: ``ANDROID_KEY_ALIAS`` / ``RELEASE_KEY_ALIAS``
- passwords: ``ANDROID_KEYSTORE_PASSWORD`` / ``ANDROID_KEY_PASSWORD`` /
  ``RELEASE_KEYSTORE_PASSWORD`` (and ``RELEASE_KEY_PASSWORD`` for the key) —
  ``keyPassword`` is only written when it differs from the keystore password,
  and only a JKS keystore honours it (PKCS#12 ignores a separate key password).

Idempotent: safe to run more than once against the same project.
"""

from __future__ import annotations

import base64
import os
import pathlib
import re
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
ANDROID_DIR = REPO_ROOT / "desktop" / "src-tauri" / "gen" / "android"
KEYSTORE_PROPERTIES = ANDROID_DIR / "keystore.properties"
GRADLE_FILE = ANDROID_DIR / "app" / "build.gradle.kts"
ROOT_GRADLE_FILE = ANDROID_DIR / "build.gradle.kts"
KOTLIN_VERSION = "2.1.20"

# Injected before the `buildTypes {` block.
SIGNING_CONFIGS = """\
    // Injected by scripts/android-release-setup.py; falls back to the debug keystore.
    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            if (keystorePropertiesFile.exists()) {
                val keystoreProperties = Properties()
                keystoreProperties.load(keystorePropertiesFile.inputStream())
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["password"] as String
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = (keystoreProperties["keyPassword"] ?: keystoreProperties["password"]) as String
            }
        }
    }
"""

SIGNING_CONFIG_LINE = (
    'signingConfig = if (rootProject.file("keystore.properties").exists()) '
    'signingConfigs.getByName("release") else signingConfigs.getByName("debug")'
)

# The tauri-cli template only allows cleartext in debug builds, which blocks the
# `http://<lan-ip>:3000` servers this self-hosted client targets (Android rejects
# the request before it leaves the app).
CLEARTEXT_LINE = 'manifestPlaceholders["usesCleartextTraffic"] = "true"'

PROPERTIES_IMPORT = "import java.util.Properties\n"
INJECTION_MARKER = "// Injected by scripts/android-release-setup.py"


def cleartext_allowed() -> bool:
    """Whether release builds may use plain HTTP (default: yes, LAN servers)."""
    return os.environ.get("PUDIM_ALLOW_CLEARTEXT", "").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def env(*names: str) -> str:
    """First non-empty value among ``names`` (later names are fallbacks)."""
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def configure_keystore() -> bool:
    """Write keystore.properties when a keystore secret is configured."""
    encoded = env("ANDROID_KEYSTORE_BASE64", "ANDROID_KEY_BASE64", "RELEASE_KEYSTORE_BASE64")
    if not encoded:
        return False

    alias = env("ANDROID_KEY_ALIAS", "RELEASE_KEY_ALIAS")
    store_password = env(
        "ANDROID_KEYSTORE_PASSWORD",
        "ANDROID_KEY_PASSWORD",
        "RELEASE_KEYSTORE_PASSWORD",
        "RELEASE_KEY_PASSWORD",
    )
    key_password = env(
        "ANDROID_KEY_PASSWORD",
        "RELEASE_KEY_PASSWORD",
        "ANDROID_KEYSTORE_PASSWORD",
        "RELEASE_KEYSTORE_PASSWORD",
    )
    if not alias or not store_password:
        sys.exit(
            "error: a keystore secret is set but ANDROID_KEY_ALIAS/"
            "ANDROID_KEYSTORE_PASSWORD are missing",
        )

    # The runner is ephemeral: keep the binary in RUNNER_TEMP, owner-only.
    keystore = pathlib.Path(os.environ.get("RUNNER_TEMP") or "/tmp") / "pudim-upload-keystore.jks"
    try:
        keystore.write_bytes(base64.b64decode(encoded, validate=True))
    except ValueError as exc:  # includes binascii.Error (invalid base64 / padding)
        sys.exit(f"error: ANDROID_KEYSTORE_BASE64 is not valid base64: {exc}")
    keystore.chmod(0o600)

    lines = [
        "# Generated by scripts/android-signing.py — never commit.",
        f"keyAlias={alias}",
        f"password={store_password}",
    ]
    if key_password != store_password:
        lines.append(f"keyPassword={key_password}")
    lines.append(f"storeFile={keystore}")
    KEYSTORE_PROPERTIES.write_text("\n".join(lines) + "\n")
    KEYSTORE_PROPERTIES.chmod(0o600)
    return True


def patch_gradle() -> None:
    """Inject the release signing config into the generated Gradle project."""
    if not GRADLE_FILE.is_file():
        sys.exit(f"error: {GRADLE_FILE} not found — run `npm run tauri android init` first")

    source = GRADLE_FILE.read_text()

    if INJECTION_MARKER in source:
        return  # already patched (idempotent)

    if "signingConfigs {" in source:
        sys.exit(
            f"error: {GRADLE_FILE} already declares signingConfigs — the tauri-cli "
            "template changed, review scripts/android-signing.py",
        )

    if PROPERTIES_IMPORT not in source:
        source = PROPERTIES_IMPORT + source

    build_types = re.search(r"^(\s*)buildTypes\s*\{", source, flags=re.MULTILINE)
    if not build_types:
        sys.exit(
            f"error: no `buildTypes {{` block in {GRADLE_FILE} "
            "— did the tauri-cli template change?",
        )
    indent = build_types.group(1)
    block = re.sub(r"^    ", indent, SIGNING_CONFIGS, flags=re.MULTILINE)
    source = source[: build_types.start()] + block + source[build_types.start() :]

    release = re.search(r'getByName\("release"\)\s*\{', source)
    if not release:
        sys.exit(
            f"error: no release build type in {GRADLE_FILE} "
            "— did the tauri-cli template change?",
        )
    line_start = source.rfind("\n", 0, release.start()) + 1
    base_indent = re.match(r"\s*", source[line_start : release.start()]).group(0)
    body_indent = base_indent + "    "
    injected = [SIGNING_CONFIG_LINE]
    if cleartext_allowed():
        injected.append(CLEARTEXT_LINE)
    source = (
        source[: release.end()]
        + "\n"
        + "\n".join(f"{body_indent}{line}" for line in injected)
        + source[release.end() :]
    )
    GRADLE_FILE.write_text(source)


def patch_kotlin_plugin() -> None:
    """Use a compiler compatible with Credential Manager's Kotlin metadata."""
    if not ROOT_GRADLE_FILE.is_file():
        sys.exit(
            f"error: {ROOT_GRADLE_FILE} not found — run `npm run tauri android init` first",
        )
    source = ROOT_GRADLE_FILE.read_text()
    updated = re.sub(
        r'(org\.jetbrains\.kotlin:kotlin-gradle-plugin:)\d+(?:\.\d+)+("?)',
        rf"\g<1>{KOTLIN_VERSION}\2",
        source,
    )
    if updated == source and f"kotlin-gradle-plugin:{KOTLIN_VERSION}" not in source:
        sys.exit(
            f"error: no Kotlin Gradle plugin declaration found in {ROOT_GRADLE_FILE} "
            "— did the tauri-cli template change?",
        )
    ROOT_GRADLE_FILE.write_text(updated)



def main() -> int:
    if not ANDROID_DIR.is_dir():
        sys.exit(f"error: {ANDROID_DIR} not found — run `npm run tauri android init` first")

    signed = configure_keystore()
    patch_gradle()
    patch_kotlin_plugin()

    if signed:
        print(f"Release signing configured from the CI keystore secrets ({KEYSTORE_PROPERTIES}).")
    else:
        print(
            "::warning::No keystore secret set (ANDROID_KEYSTORE_BASE64) — the release "
            "APK will be debug-signed and Google Play Protect may block the sideload.",
        )
    if cleartext_allowed():
        print("Release builds may use plain HTTP (android:usesCleartextTraffic=true).")
    else:
        print("PUDIM_ALLOW_CLEARTEXT=false — release builds require https:// servers.")
    print("Google sign-in uses Android Credential Manager; no OAuth redirect intent filter is needed.")
    print(f"Android Kotlin Gradle plugin aligned to {KOTLIN_VERSION} for Credential Manager dependencies.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
