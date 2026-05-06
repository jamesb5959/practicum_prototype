from __future__ import annotations

import argparse
import json
import os
import platform
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


try:
    import dsgp4
    import torch
    from dsgp4.util import initialize_tle, propagate
except Exception as exc:  # pragma: no cover
    print(json.dumps({"error": f"Missing Python dependency: {exc}"}))
    sys.exit(1)

from train_mldsgp4_residual import (
    MINUTES_PER_DAY,
    NORMALIZATION_R,
    NORMALIZATION_V,
    ResidualMlDsgp4,
    normalize_state,
    tle_feature_vector,
)


DEFAULT_MODEL_PATH = Path(__file__).resolve().parent / "models" / "mldsgp4_best_model_improved.pth"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--line1", required=True)
    parser.add_argument("--line2", required=True)
    parser.add_argument("--hours", type=int, required=True)
    parser.add_argument("--step-minutes", type=int, default=60)
    parser.add_argument("--model-path", default=str(DEFAULT_MODEL_PATH))
    return parser.parse_args()


def parse_tle_epoch(line1: str) -> datetime:
    epoch_year = int(line1[18:20])
    epoch_day = float(line1[20:32])
    full_year = 2000 + epoch_year if epoch_year < 57 else 1900 + epoch_year
    year_start = datetime(full_year, 1, 1, tzinfo=timezone.utc)
    return year_start + timedelta(days=epoch_day - 1)


def unnormalize_state(state_norm: torch.Tensor, normalization_r: float, normalization_v: float) -> torch.Tensor:
    state = state_norm.clone()
    state[:, :3] = state[:, :3] * normalization_r
    state[:, 3:] = state[:, 3:] * normalization_v
    return state


def mps_available() -> bool:
    return bool(
        hasattr(torch.backends, "mps")
        and torch.backends.mps.is_available()
        and torch.backends.mps.is_built()
    )


def resolve_device() -> str:
    requested_device = os.environ.get("TLE_PREDICTION_DEVICE", "cpu").strip().lower()
    if requested_device == "cuda":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if requested_device == "mps":
        return "mps" if platform.system() == "Darwin" and mps_available() else "cpu"
    if requested_device == "auto":
        if torch.cuda.is_available():
            return "cuda"
        if platform.system() == "Darwin" and mps_available():
            return "mps"
    return "cpu"


def build_tle(name: str, line1: str, line2: str):
    tle = dsgp4.tle.TLE([f"0 {name}", line1, line2])
    initialize_tle(tle, with_grad=False)
    return tle


def propagate_state(tle, delta_minutes: float) -> torch.Tensor:
    return propagate(tle, float(delta_minutes), initialized=True).reshape(-1, 6)[0].detach().cpu().float()


def build_residual_features(tle, baseline_norm: torch.Tensor, delta_minutes: float) -> torch.Tensor:
    delta_days = delta_minutes / MINUTES_PER_DAY
    delta_orbit_scale = torch.tensor([delta_days, torch.tanh(torch.tensor(delta_days)).item()], dtype=torch.float32)
    return torch.cat([tle_feature_vector(tle), baseline_norm, delta_orbit_scale], dim=0)


def run_legacy_model(tle, model_path: Path, device: str, tsinces: torch.Tensor) -> torch.Tensor:
    ml_dsgp4 = dsgp4.mldsgp4(hidden_size=100)
    ml_dsgp4.load_model(path=str(model_path), device=device)
    ml_dsgp4 = ml_dsgp4.double()
    ml_dsgp4.eval()
    with torch.no_grad():
        prediction_norm = ml_dsgp4(tle, tsinces.to(device=device, dtype=torch.float64))
    prediction = unnormalize_state(
        prediction_norm.detach().cpu(),
        ml_dsgp4.normalization_R,
        ml_dsgp4.normalization_V,
    )
    return prediction


def run_residual_model(tle, checkpoint: dict, device: str, tsinces: torch.Tensor) -> torch.Tensor:
    model = ResidualMlDsgp4(
        input_dim=int(checkpoint["input_dim"]),
        hidden_size=int(checkpoint["hidden_size"]),
        max_residual=float(checkpoint.get("max_residual", 0.15)),
    ).float().to(device=device, dtype=torch.float32)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    baseline_states = []
    feature_rows = []
    for minutes in tsinces.detach().cpu().tolist():
        baseline_state = propagate_state(tle, float(minutes))
        baseline_norm = normalize_state(baseline_state)
        features = build_residual_features(tle, baseline_norm, float(minutes))
        baseline_states.append(baseline_norm)
        feature_rows.append(features)

    baseline_batch = torch.stack(baseline_states).to(device=device, dtype=torch.float32)
    feature_batch = torch.stack(feature_rows).to(device=device, dtype=torch.float32)

    with torch.no_grad():
        prediction_norm, _ = model(feature_batch, baseline_batch)

    normalization_r = float(checkpoint.get("normalization_R", NORMALIZATION_R))
    normalization_v = float(checkpoint.get("normalization_V", NORMALIZATION_V))
    prediction = unnormalize_state(prediction_norm.detach().cpu(), normalization_r, normalization_v)
    return prediction


def load_prediction_states(tle, model_path: Path, device: str, tsinces: torch.Tensor) -> tuple[torch.Tensor, str]:
    checkpoint = torch.load(model_path, map_location="cpu")
    if isinstance(checkpoint, dict) and "model_state_dict" in checkpoint and "input_dim" in checkpoint:
        return run_residual_model(tle, checkpoint, device, tsinces), "residual"
    return run_legacy_model(tle, model_path, device, tsinces), "legacy"


def main() -> None:
    args = parse_args()
    model_path = Path(args.model_path)
    if not model_path.exists():
        print(json.dumps({"error": f"Model file not found at {model_path}"}))
        sys.exit(1)

    hours = max(1, min(args.hours, 240))
    step_minutes = max(1, min(args.step_minutes, 120))

    tle = build_tle(args.name, args.line1, args.line2)
    device = resolve_device()

    epoch = parse_tle_epoch(args.line1)
    now_utc = datetime.now(timezone.utc)
    start_minutes = max(0.0, (now_utc - epoch).total_seconds() / 60.0)
    tsinces = torch.arange(
        start_minutes,
        start_minutes + hours * 60 + 1,
        step_minutes,
        dtype=torch.float32,
    )

    prediction, model_mode = load_prediction_states(tle, model_path, device, tsinces)
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
                "sampleStepHours": step_minutes / 60.0,
                "device": device,
                "modelMode": model_mode,
                "startMinutesSinceEpoch": start_minutes,
                "samples": samples,
            }
        )
    )


if __name__ == "__main__":
    main()
