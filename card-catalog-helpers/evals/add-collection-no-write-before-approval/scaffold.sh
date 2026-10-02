source "$(dirname "${BASH_SOURCE[0]}")/../_fixtures/lib.sh"

place adrs docs/adr
commit "Add ADRs"
reindex
commit "Index ADRs"
place runbooks ops/runbooks
commit "Add runbooks"
