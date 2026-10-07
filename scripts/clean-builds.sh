#!/usr/bin/env bash
# Reclaim disk space used by the gitignored Rust build caches.
#
# Every Rust crate in this repo keeps its own `target/` directory, and debug
# builds retain unoptimized artifacts plus an incremental-compilation cache
# that Cargo never garbage-collects. On this repo the three `target/` trees
# can exceed 50 GB. Run this when `df` gets tight.
#
# Usage:
#   ./scripts/clean-builds.sh                # full clean of all three crates
#   ./scripts/clean-builds.sh --incremental  # only prune incremental caches
#   ./scripts/clean-builds.sh --dry-run      # report sizes, delete nothing
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Crate roots that own a `target/` directory (backend, Tauri core, Android plugin).
CRATES=(
  "backend"
  "desktop/src-tauri"
  "desktop/src-tauri/plugins/pudim-android-native"
)

CYAN='\033[0;36m'; GREEN='\033[0;32m'; NC='\033[0m'
info() { echo -e "${CYAN}[clean]${NC} $1"; }
ok()   { echo -e "${GREEN}[clean]${NC} $1"; }

human() { du -sh "$1" 2>/dev/null | cut -f1; }

MODE="full"
case "${1:-}" in
  --incremental) MODE="incremental" ;;
  --dry-run)     MODE="dry-run" ;;
  -h|--help)     sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  "")            ;;
  *)             echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
esac

case "$MODE" in
  full)
    for crate in "${CRATES[@]}"; do
      target="$ROOT_DIR/$crate/target"
      [ -d "$target" ] || continue
      info "cargo clean — $crate/target ($(human "$target"))"
      ( cd "$ROOT_DIR/$crate" && cargo clean )
    done
    ;;
  incremental)
    # Removing the incremental caches reclaims the bulk of the space while
    # keeping the compiled dependency artifacts warm for the next build.
    shopt -s nullglob
    for crate in "${CRATES[@]}"; do
      for inc in "$ROOT_DIR/$crate"/target/*/incremental; do
        info "prune $crate — ${inc#"$ROOT_DIR/"}"
        rm -rf "$inc"
      done
    done
    shopt -u nullglob
    ;;
  dry-run)
    total=0
    for crate in "${CRATES[@]}"; do
      target="$ROOT_DIR/$crate/target"
      [ -d "$target" ] || continue
      printf '  %8s  %s\n' "$(human "$target")" "$crate/target"
      total=$(( total + $(du -sk "$target" | cut -f1) ))
    done
    echo "  --------"
    info "~$(( total / 1024 / 1024 )) GiB total across all target/ dirs (nothing deleted)"
    exit 0
    ;;
esac

echo
for crate in "${CRATES[@]}"; do
  target="$ROOT_DIR/$crate/target"
  [ -d "$target" ] && ok "$crate/target is now $(human "$target")" || ok "$crate/target removed"
done
