source "$(dirname "${BASH_SOURCE[0]}")/../_fixtures/lib.sh"

place adrs docs/adr
commit "Add ADRs"
reindex
commit "Index ADRs"
place postmortems docs/incidents
cat > card-catalog.json <<'JSON'
{
  "$schema": "https://unpkg.com/@someotherdustin/card-catalog/card-catalog.schema.json",
  "collections": [
    {
      "dir": "docs/incidents",
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
commit "Index incidents"
cat > card-catalog.json <<'JSON'
{
  "$schema": "https://unpkg.com/@someotherdustin/card-catalog/card-catalog.schema.json",
  "collections": []
}
JSON
commit "Stop indexing incidents"
