source "$(dirname "${BASH_SOURCE[0]}")/../_fixtures/lib.sh"

place adrs docs/adr
commit "Add ADRs"
reindex
commit "Index ADRs"
place billing-decisions services/billing/decisions
commit "Add billing decisions"
