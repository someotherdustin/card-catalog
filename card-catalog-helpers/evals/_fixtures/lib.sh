# Shared setup for eval cases. A case's scaffold.sh sources this, which
# starts a git repo in the (empty) run workspace, then calls the functions
# below. Fixture trees are kept under neutral names (adrs/, not docs/adr/) so
# this repo's own card-catalog doesn't treat them as collections, and every
# index is generated here, by this repo's CLI, rather than committed.

set -euo pipefail
fixtures="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="$fixtures/../../../card-catalog-plugin/scripts/cli.ts"

# place <fixture> <dir>: copies a fixture tree into the workspace at <dir>.
place() {
  mkdir -p "$2"
  cp -R "$fixtures/$1/." "$2/"
}

# commit <message>: commits everything in the workspace.
commit() {
  git add -A
  git -c user.name=eval -c user.email=eval@example.com commit -qm "$1"
}

# reindex: writes every collection's index, as the write hook would have.
reindex() {
  node "$cli" reindex >/dev/null
}

git init -q
