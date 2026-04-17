from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path


DATA_PATH = Path(__file__).resolve().parent / "data" / "88_most_recent_satellites_LEO.csv"
OUT_PATH = Path(__file__).resolve().parent / "cache" / "training_pairs.jsonl"


def parse_epoch(row: dict[str, str]) -> datetime:
    raw = (row.get("epoch") or "").strip()
    if not raw:
      raise ValueError("Missing epoch field")
    return datetime.strptime(raw, "%m/%d/%Y %H:%M")


def load_rows() -> list[dict[str, str]]:
    with DATA_PATH.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return list(reader)


def build_pairs(rows: list[dict[str, str]]) -> list[dict[str, object]]:
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        key = (row.get("satellite_number") or "").strip()
        if not key:
            continue
        grouped[key].append(row)

    pairs: list[dict[str, object]] = []
    for satellite_number, items in grouped.items():
        if len(items) < 2:
            continue
        items.sort(key=parse_epoch)
        for old_row, new_row in zip(items, items[1:]):
            old_epoch = parse_epoch(old_row)
            new_epoch = parse_epoch(new_row)
            delta_minutes = (new_epoch - old_epoch).total_seconds() / 60.0
            if delta_minutes <= 0:
                continue
            pairs.append(
                {
                    "satellite_number": satellite_number,
                    "old_name": old_row.get("tle_title") or f"Sat {satellite_number}",
                    "old_line1": old_row["tle_line1"],
                    "old_line2": old_row["tle_line2"],
                    "new_name": new_row.get("tle_title") or f"Sat {satellite_number}",
                    "new_line1": new_row["tle_line1"],
                    "new_line2": new_row["tle_line2"],
                    "old_epoch": old_epoch.isoformat(),
                    "new_epoch": new_epoch.isoformat(),
                    "delta_minutes": delta_minutes,
                }
            )
    return pairs


def main() -> None:
    rows = load_rows()
    pairs = build_pairs(rows)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as handle:
        for pair in pairs:
            handle.write(json.dumps(pair) + "\n")

    print(f"Wrote {len(pairs)} training pairs to {OUT_PATH}")


if __name__ == "__main__":
    main()
