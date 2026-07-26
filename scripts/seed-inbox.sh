#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Seed the KanDeck inbox with 15 realistic personal-kanban items.
#
# Usage:
#   ./scripts/seed-inbox.sh
#   BASE_URL=http://localhost:8080 API_KEY=your-key ./scripts/seed-inbox.sh
#
# Requires: bash, curl, python3 (all standard on macOS).
# ---------------------------------------------------------------------------
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
API_KEY="${API_KEY:-change-me-api-key}"

# Post one inbox item. Args: subject  priority  tags(csv)  source  dueInDays(optional)
post() {
  local subject="$1" priority="$2" tags="$3" source="$4" due="${5:-}"
  local body
  body=$(python3 - "$subject" "$priority" "$tags" "$source" "$due" <<'PY'
import json, sys, datetime
subject, priority, tags, source, due = sys.argv[1:6]
item = {
    "subject": subject,
    "priority": priority,
    "tags": [t.strip() for t in tags.split(",") if t.strip()],
    "source": source,
}
if due:
    d = datetime.date.today() + datetime.timedelta(days=int(due))
    item["dueDate"] = d.isoformat() + "T12:00:00"  # noon-local avoids tz drift
print(json.dumps(item))
PY
)
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/api/inbox" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body")
  printf "  [%s] %s\n" "$code" "$subject"
}

echo "Seeding KanDeck inbox → $BASE_URL"

# subject                                    priority  tags                    source     due(days)
post "Pay credit card bill"                  urgent   "finance,bills"          email      2
post "Renew passport before it expires"      urgent   "travel,admin"           reminder   21
post "Renew car registration"               high     "car,admin"              email      5
post "Call Mom for her birthday"            high     "family"                 mobile     3
post "Return the Amazon package"            high     "errands,shopping"       mobile     4
post "Back up laptop photos to cloud"       high     "tech,admin"             api
post "Book flights for the summer trip"     medium   "travel,planning"        web        30
post "Update resume and LinkedIn"           medium   "career"                 web
post "Fix the leaky kitchen faucet"         medium   "home,repairs"           mobile
post "Set up automatic savings transfer"    medium   "finance"                web
post "Plan date night"                      medium   "relationship"           mobile     7
post "Meal prep for the week"               low      "health,cooking"         mobile     1
post "Read next chapter of Atomic Habits"   low      "reading,growth"         mobile
post "Clean out the garage"                 low      "home,weekend"           web
post "Schedule a dentist appointment"       low      "health,errands"         reminder   14

echo "Done — 15 items sent. Open the Inbox panel (it updates live)."
