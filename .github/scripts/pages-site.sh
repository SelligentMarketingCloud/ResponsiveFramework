#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:?Usage: pages-site.sh sanitize|add-eoa|update-root|cleanup}"
SITE_DIR="${SITE_DIR:-site}"
EOA_DIR="${EOA_DIR:-eoa}"
MAX_AGE_DAYS="${EOA_MAX_AGE_DAYS:-30}"

has_legacy_layout_markers() {
  local source="$1"
  # `emailonacid` and the other markers are repository/workflow directories that should never be published.
  local markers=("emailonacid" "source" "pages-report" "site")
  for marker in "${markers[@]}"; do
    if [ -d "$source/$marker" ]; then
      return 0
    fi
  done
  return 1
}

should_normalize_to_output() {
  local source="$1"
  [ -d "$source/output" ] || return 1
  if [ ! -f "$source/index.html" ]; then
    return 0
  fi
  has_legacy_layout_markers "$source"
}

case "$COMMAND" in
  sanitize)
    # Remove legacy repository directories that should never be published
    for dir in emailonacid source pages-report site; do
      if [ -d "$SITE_DIR/$dir" ]; then
        echo "Removing legacy directory from site: $SITE_DIR/$dir"
        rm -rf "$SITE_DIR/$dir"
      fi
    done
    # Promote output/ contents to root when the site was committed in the old layout
    if should_normalize_to_output "$SITE_DIR"; then
      echo "Normalizing: promoting $SITE_DIR/output/ contents to site root"
      tmp_dir="$(mktemp -d)"
      cp -r "$SITE_DIR/output"/. "$tmp_dir/"
      rm -rf "$SITE_DIR/output"
      cp -r "$tmp_dir"/. "$SITE_DIR/"
      rm -rf "$tmp_dir"
    fi
    ;;
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
    if should_normalize_to_output "$SOURCE"; then
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
