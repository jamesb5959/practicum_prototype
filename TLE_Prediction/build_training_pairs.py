from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path


DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_OUT_PATH = Path(__file__).resolve().parent / "cache" / "training_pairs.jsonl"
DEFAULT_CANDIDATES = [
    DEFAULT_DATA_DIR / "100_most_recent_satellites.csv",
    DEFAULT_DATA_DIR / "88_most_recent_satellites_LEO.csv",
    DEFAULT_DATA_DIR / "enriched_with_missions.csv",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build old/new same-satellite training pairs from a historical TLE CSV."
    )
    parser.add_argument(
        "--data-path",
        type=Path,
        default=None,
        help="Optional explicit CSV path. If omitted, the script inspects known data files.",
    )
    parser.add_argument(
        "--out-path",
        type=Path,
        default=DEFAULT_OUT_PATH,
        help="Path to write training_pairs.jsonl",
    )
    return parser.parse_args()


def parse_epoch(row: dict[str, str]) -> datetime:
    raw = (row.get("epoch") or "").strip()
    if not raw:
        raise ValueError("Missing epoch field")
    for fmt in ("%m/%d/%Y %H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    raise ValueError(f"Unsupported epoch format: {raw}")


def load_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def summarize_rows(rows: list[dict[str, str]]) -> dict[str, int]:
    counts = Counter(
        (row.get("satellite_number") or "").strip()
        for row in rows
        if (row.get("satellite_number") or "").strip()
    )
    return {
        "rows": len(rows),
        "unique_satellites": len(counts),
        "repeated_satellites": sum(1 for value in counts.values() if value > 1),
        "max_repeat": max(counts.values(), default=0),
    }


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

        try:
            items.sort(key=parse_epoch)
        except ValueError:
            continue

        for old_row, new_row in zip(items, items[1:]):
            try:
                old_epoch = parse_epoch(old_row)
                new_epoch = parse_epoch(new_row)
            except ValueError:
                continue

            if (
                (old_row.get("tle_line1") or "").strip() == (new_row.get("tle_line1") or "").strip()
                and (old_row.get("tle_line2") or "").strip() == (new_row.get("tle_line2") or "").strip()
            ):
                continue

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


def pick_input_path(explicit_path: Path | None) -> Path:
    if explicit_path is not None:
        if not explicit_path.exists():
            raise FileNotFoundError(f"CSV not found: {explicit_path}")
        return explicit_path

    summaries = []
    for path in DEFAULT_CANDIDATES:
        if not path.exists():
            continue
        rows = load_rows(path)
        summary = summarize_rows(rows)
        summaries.append((path, summary))

    if not summaries:
        raise FileNotFoundError(
            f"No candidate CSVs found in {DEFAULT_DATA_DIR}"
        )

    best_path, best_summary = max(
        summaries,
        key=lambda item: (item[1]["repeated_satellites"], item[1]["max_repeat"], item[1]["rows"]),
    )

    print("Input dataset summary:")
    for path, summary in summaries:
        print(
            f"  {path.name}: rows={summary['rows']}, "
            f"unique={summary['unique_satellites']}, "
            f"repeated_sats={summary['repeated_satellites']}, "
            f"max_repeat={summary['max_repeat']}"
        )

    if best_summary["repeated_satellites"] == 0:
        raise RuntimeError(
            "No candidate dataset contains repeated satellite timestamps, so no old/new training "
            "pairs can be built. You need a historical CSV with multiple rows per satellite_number."
        )

    print(f"Using {best_path.name} because it has the strongest repeated-satellite coverage.")
    return best_path


def main() -> None:
    args = parse_args()
    data_path = pick_input_path(args.data_path)
    rows = load_rows(data_path)
    pairs = build_pairs(rows)

    args.out_path.parent.mkdir(parents=True, exist_ok=True)
    with args.out_path.open("w", encoding="utf-8") as handle:
        for pair in pairs:
            handle.write(json.dumps(pair) + "\n")

    print(f"Wrote {len(pairs)} training pairs to {args.out_path}")
    if not pairs:
        raise RuntimeError(
            f"{data_path.name} loaded successfully, but it still produced 0 valid chronological "
            "same-satellite pairs. Check the epoch column and whether the file actually contains "
            "multiple timestamps per satellite_number."
        )


if __name__ == "__main__":
    main()
