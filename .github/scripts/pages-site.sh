#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:?Usage: pages-site.sh add-eoa|update-root|cleanup}"
SITE_DIR="${SITE_DIR:-site}"
EOA_DIR="${EOA_DIR:-eoa}"
MAX_AGE_DAYS="${EOA_MAX_AGE_DAYS:-30}"

has_legacy_layout_markers() {
  local source="$1"
  local markers=("emailonacid" "source" "pages-report" "site")
  for marker in "${markers[@]}"; do
    if [ -d "$source/$marker" ]; then
      return 0
    fi
  done
  return 1
}

case "$COMMAND" in
  add-eoa)
    RUN_ID="${2:?run id required}"
    RUN_ATTEMPT="${3:?run attempt required}"
    SOURCE="${4:?source path required}"
    DEST="$SITE_DIR/$EOA_DIR/run-${RUN_ID}-${RUN_ATTEMPT}"
    mkdir -p "$DEST"
    cp -r "$SOURCE"/. "$DEST/"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$DEST/.published"
    ;;
  update-root)
    SOURCE="${2:?source path required}"
    # Legacy/mispackaged artifacts can contain repository folders at root with the real site under output/.
    if [ -d "$SOURCE/output" ] && { [ ! -f "$SOURCE/index.html" ] || has_legacy_layout_markers "$SOURCE"; }; then
      SOURCE="$SOURCE/output"
    fi
    mkdir -p "$SITE_DIR"
    rsync -a --delete "$SOURCE"/ "$SITE_DIR"/ --exclude "$EOA_DIR"
    ;;
  cleanup)
    TARGET="$SITE_DIR/$EOA_DIR"
    if [ ! -d "$TARGET" ]; then
      exit 0
    fi
    find "$TARGET" -mindepth 2 -maxdepth 2 -name '.published' -mtime +"$MAX_AGE_DAYS" -print0 |
      while IFS= read -r -d '' marker; do
        report_dir="$(dirname "$marker")"
        echo "Removing expired EOA report: $report_dir"
        rm -rf "$report_dir"
      done
    ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    exit 1
    ;;
esac
