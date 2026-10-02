source "$(dirname "${BASH_SOURCE[0]}")/../_fixtures/lib.sh"

place adrs docs/adr
commit "Add ADRs"
reindex
commit "Index ADRs"
place postmortems docs/postmortems
cat > card-catalog.json <<'JSON'
{
  "$schema": "https://unpkg.com/@someotherdustin/card-catalog/card-catalog.schema.json",
  "collections": [
    {
      "dir": "docs/postmortems",
      "type": "postmortem",
      "id": "{date}-{slug}",
      "summary": [
        "section:Impact",
        "lead"
      ]
    }
  ]
}
JSON
reindex
commit "Index postmortems"
