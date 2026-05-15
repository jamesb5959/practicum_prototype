#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_SOURCE_CSV="$SCRIPT_DIR/data/88_most_recent_satellites_LEO.csv"
DEFAULT_OUTPUT_CSV="$SCRIPT_DIR/data/spacetrack_history.csv"
COOKIE_JAR="${TMPDIR:-/tmp}/spacetrack_cookie_$$.txt"

cleanup() {
  rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

usage() {
  cat <<EOF
Usage:
  $(basename "$0") [days_back] [output_csv] [source_csv]

Examples:
  $(basename "$0") 30
  $(basename "$0") 90 "$SCRIPT_DIR/data/spacetrack_history_90d.csv"
  $(basename "$0") 60 "$SCRIPT_DIR/data/spacetrack_history.csv" "$SCRIPT_DIR/data/enriched_with_missions.csv"

Required environment variables:
  ST_USERNAME   Space-Track username
  ST_PASSWORD   Space-Track password

Arguments:
  days_back   How many days of GP history to request. Default: 30
  output_csv  Where to write the historical CSV. Default: $DEFAULT_OUTPUT_CSV
  source_csv  CSV used to extract the NORAD IDs to request. Default: $DEFAULT_SOURCE_CSV

What it does:
  1. Reads satellite_number values from the source CSV.
  2. Logs into Space-Track.
  3. Downloads GP history for those NORAD IDs over the requested window.
  4. Writes a CSV with the columns expected by build_training_pairs.py.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

DAYS_BACK="${1:-30}"
OUTPUT_CSV="${2:-$DEFAULT_OUTPUT_CSV}"
SOURCE_CSV="${3:-$DEFAULT_SOURCE_CSV}"

if ! [[ "$DAYS_BACK" =~ ^[0-9]+$ ]]; then
  echo "days_back must be a positive integer." >&2
  exit 1
fi

if [[ -z "${ST_USERNAME:-}" || -z "${ST_PASSWORD:-}" ]]; then
  echo "ST_USERNAME and ST_PASSWORD must be set in the environment." >&2
  exit 1
fi

if [[ ! -f "$SOURCE_CSV" ]]; then
  echo "Source CSV not found: $SOURCE_CSV" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_CSV")"

NORAD_BATCHES="$(
  SOURCE_CSV="$SOURCE_CSV" python3 - <<'PY'
import csv
import os
from pathlib import Path

source = Path(os.environ["SOURCE_CSV"])
with source.open(newline="", encoding="utf-8") as handle:
    rows = list(csv.DictReader(handle))

ids = sorted(
    {
        (row.get("satellite_number") or "").strip()
        for row in rows
        if (row.get("satellite_number") or "").strip()
    },
    key=lambda value: int(value),
)

batch_size = 40
for index in range(0, len(ids), batch_size):
    print(",".join(ids[index:index + batch_size]))
PY
)"

if [[ -z "$NORAD_BATCHES" ]]; then
  echo "No satellite_number values were found in $SOURCE_CSV" >&2
  exit 1
fi

echo "Logging into Space-Track..."
curl -sS \
  -c "$COOKIE_JAR" \
  -d "identity=$ST_USERNAME&password=$ST_PASSWORD" \
  "https://www.space-track.org/ajaxauth/login" >/dev/null

TMP_JSON="$(mktemp "${TMPDIR:-/tmp}/spacetrack_history_XXXXXX.jsonl")"
trap 'cleanup; rm -f "$TMP_JSON"' EXIT
: >"$TMP_JSON"

echo "Downloading GP history for the NORAD IDs in $(basename "$SOURCE_CSV") over the last $DAYS_BACK days..."
while IFS= read -r batch; do
  [[ -z "$batch" ]] && continue
  QUERY_URL="https://www.space-track.org/basicspacedata/query/class/gp_history/NORAD_CAT_ID/$batch/CREATION_DATE/%3Enow-$DAYS_BACK/orderby/NORAD_CAT_ID%20asc,EPOCH%20asc/format/json"
  curl -sS -b "$COOKIE_JAR" "$QUERY_URL" >>"$TMP_JSON"
  printf '\n' >>"$TMP_JSON"
done <<<"$NORAD_BATCHES"

echo "Transforming Space-Track JSON into training CSV..."
TMP_JSON="$TMP_JSON" OUTPUT_CSV="$OUTPUT_CSV" python3 - <<'PY'
import csv
import json
import os
from pathlib import Path

json_path = Path(os.environ["TMP_JSON"])
output_path = Path(os.environ["OUTPUT_CSV"])

records = []
with json_path.open(encoding="utf-8") as handle:
    for line in handle:
        line = line.strip()
        if not line:
            continue
        payload = json.loads(line)
        if isinstance(payload, list):
            records.extend(payload)

records.sort(
    key=lambda row: (
        int(row.get("NORAD_CAT_ID") or 0),
        row.get("EPOCH") or "",
        row.get("CREATION_DATE") or "",
    )
)

fieldnames = [
    "satellite_number",
    "epoch",
    "publish_epoch",
    "tle_line1",
    "tle_line2",
    "tle_title",
    "tle_international_designator",
    "classification",
]

with output_path.open("w", newline="", encoding="utf-8") as handle:
    writer = csv.DictWriter(handle, fieldnames=fieldnames)
    writer.writeheader()
    for row in records:
        norad = str(row.get("NORAD_CAT_ID") or "").strip()
        name = str(row.get("OBJECT_NAME") or f"Sat {norad}").strip()
        object_id = str(row.get("OBJECT_ID") or "").strip()
        classification = str(row.get("CLASSIFICATION_TYPE") or "U").strip()
        tle_line1 = str(row.get("TLE_LINE1") or "").strip()
        tle_line2 = str(row.get("TLE_LINE2") or "").strip()
        epoch = str(row.get("EPOCH") or "").strip()
        creation = str(row.get("CREATION_DATE") or epoch).strip()
        writer.writerow(
            {
                "satellite_number": norad,
                "epoch": epoch.replace("T", " ")[:16] if epoch else "",
                "publish_epoch": creation.replace("T", " ")[:16] if creation else "",
                "tle_line1": tle_line1,
                "tle_line2": tle_line2,
                "tle_title": name,
                "tle_international_designator": object_id,
                "classification": classification,
            }
        )

print(f"Wrote {len(records)} historical rows to {output_path}")
PY

echo
echo "Next steps:"
echo "  python3 \"$SCRIPT_DIR/build_training_pairs.py\" --data-path \"$OUTPUT_CSV\""
echo "  python3 \"$SCRIPT_DIR/train_mldsgp4_residual.py\""
