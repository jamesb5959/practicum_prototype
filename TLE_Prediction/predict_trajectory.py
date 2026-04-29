from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


try:
    import dsgp4
    import torch
except Exception as exc:  # pragma: no cover
    print(json.dumps({"error": f"Missing Python dependency: {exc}"}))
    sys.exit(1)


DEFAULT_MODEL_PATH = Path(__file__).resolve().parent / "models" / "mldsgp4_best_model.pth"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--line1", required=True)
    parser.add_argument("--line2", required=True)
    parser.add_argument("--hours", type=int, required=True)
    parser.add_argument("--model-path", default=str(DEFAULT_MODEL_PATH))
    return parser.parse_args()


def parse_tle_epoch(line1: str) -> datetime:
    epoch_year = int(line1[18:20])
    epoch_day = float(line1[20:32])
    full_year = 2000 + epoch_year if epoch_year < 57 else 1900 + epoch_year
    year_start = datetime(full_year, 1, 1, tzinfo=timezone.utc)
    return year_start + timedelta(days=epoch_day - 1)


def unnormalize_state(state_norm, model):
    state = state_norm.clone()
    state[:, :3] = state_norm[:, :3] * model.normalization_R
    state[:, 3:] = state_norm[:, 3:] * model.normalization_V
    return state


def main() -> None:
    args = parse_args()
    model_path = Path(args.model_path)
    if not model_path.exists():
        print(json.dumps({"error": f"Model file not found at {model_path}"}))
        sys.exit(1)

    hours = max(1, min(args.hours, 240))

    tle_lines = [f"0 {args.name}", args.line1, args.line2]
    tle = dsgp4.tle.TLE(tle_lines)
    dsgp4.initialize_tle(tle)

    requested_device = os.environ.get("TLE_PREDICTION_DEVICE", "cpu").strip().lower()
    if requested_device == "cuda" and torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"

    ml_dsgp4 = dsgp4.mldsgp4(hidden_size=100)
    ml_dsgp4.load_model(path=str(model_path), device=device)
    ml_dsgp4.eval()

    epoch = parse_tle_epoch(args.line1)
    now_utc = datetime.now(timezone.utc)
    start_minutes = max(0.0, (now_utc - epoch).total_seconds() / 60.0)
    tsinces = torch.arange(
        start_minutes,
        start_minutes + hours * 60 + 1,
        60,
        dtype=torch.float32,
        device=device,
    )
    with torch.no_grad():
        prediction_norm = ml_dsgp4(tle, tsinces)
    prediction = unnormalize_state(prediction_norm, ml_dsgp4).detach().cpu()
    tsince_values = tsinces.detach().cpu().tolist()

    samples = []
    for i, minutes in enumerate(tsince_values):
        position = prediction[i, :3].tolist()
        velocity = prediction[i, 3:].tolist()
        sample_time = epoch + timedelta(minutes=float(minutes))
        samples.append(
            {
                "minutesSinceEpoch": float(minutes),
                "isoTime": sample_time.isoformat(),
                "positionKm": [float(value) for value in position],
                "velocityKmS": [float(value) for value in velocity],
            }
        )

    print(
        json.dumps(
            {
                "name": args.name,
                "epochIso": epoch.isoformat(),
                "frame": "TEME",
                "hours": hours,
                "sampleStepHours": 1,
                "device": device,
                "startMinutesSinceEpoch": start_minutes,
                "samples": samples,
            }
        )
    )


if __name__ == "__main__":
    main()
