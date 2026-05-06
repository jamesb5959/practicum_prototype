from __future__ import annotations

import argparse
import statistics
from pathlib import Path

import torch
from torch.utils.data import DataLoader, random_split

from train_mldsgp4_residual import (
    DEFAULT_PAIRS_PATH,
    NORMALIZATION_R,
    NORMALIZATION_V,
    PairSample,
    ResidualMlDsgp4,
    ResidualTleDataset,
    load_pairs,
    resolve_device,
    set_seed,
)


DEFAULT_CHECKPOINT_PATH = Path(__file__).resolve().parent / "models" / "mldsgp4_best_model_improved.pth"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate the improved residual ML-dSGP4 model against the SGP4 baseline."
    )
    parser.add_argument("--pairs-path", type=Path, default=DEFAULT_PAIRS_PATH)
    parser.add_argument("--checkpoint-path", type=Path, default=DEFAULT_CHECKPOINT_PATH)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--validation-split", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--split", choices=["all", "train", "val"], default="val")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda", "mps"], default="auto")
    return parser.parse_args()


def make_eval_subset(
    dataset: ResidualTleDataset, validation_split: float, seed: int, split: str
):
    if split == "all":
        return dataset

    validation_size = max(1, int(len(dataset) * validation_split))
    training_size = max(1, len(dataset) - validation_size)
    if training_size + validation_size > len(dataset):
        validation_size = len(dataset) - training_size

    generator = torch.Generator().manual_seed(seed)
    train_set, val_set = random_split(dataset, [training_size, validation_size], generator=generator)
    return train_set if split == "train" else val_set


def rmse_per_sample(pred: torch.Tensor, target: torch.Tensor, scale: float, sl: slice) -> torch.Tensor:
    diff = (pred[:, sl] - target[:, sl]) * scale
    return torch.sqrt(torch.mean(diff * diff, dim=1))


def summarize(values: list[float]) -> dict[str, float]:
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    median = (
        ordered[midpoint]
        if len(ordered) % 2 == 1
        else (ordered[midpoint - 1] + ordered[midpoint]) / 2.0
    )
    return {
        "mean": statistics.fmean(ordered),
        "median": median,
        "max": max(ordered),
    }


def evaluate_model(
    model: ResidualMlDsgp4,
    loader: DataLoader,
    device: torch.device,
):
    baseline_pos: list[float] = []
    baseline_vel: list[float] = []
    model_pos: list[float] = []
    model_vel: list[float] = []

    model.eval()
    with torch.no_grad():
        for features, baseline_norm, target_norm, _residual_target in loader:
            features = features.to(device=device, dtype=torch.float32)
            baseline_norm = baseline_norm.to(device=device, dtype=torch.float32)
            target_norm = target_norm.to(device=device, dtype=torch.float32)

            prediction_norm, _ = model(features, baseline_norm)

            baseline_pos.extend(
                rmse_per_sample(baseline_norm.cpu(), target_norm.cpu(), NORMALIZATION_R, slice(0, 3)).tolist()
            )
            baseline_vel.extend(
                rmse_per_sample(baseline_norm.cpu(), target_norm.cpu(), NORMALIZATION_V, slice(3, 6)).tolist()
            )
            model_pos.extend(
                rmse_per_sample(prediction_norm.cpu(), target_norm.cpu(), NORMALIZATION_R, slice(0, 3)).tolist()
            )
            model_vel.extend(
                rmse_per_sample(prediction_norm.cpu(), target_norm.cpu(), NORMALIZATION_V, slice(3, 6)).tolist()
            )

    return {
        "baseline_position_km": summarize(baseline_pos),
        "baseline_velocity_kms": summarize(baseline_vel),
        "model_position_km": summarize(model_pos),
        "model_velocity_kms": summarize(model_vel),
        "pair_count": len(model_pos),
    }


def print_summary(metrics: dict[str, object], split: str) -> None:
    print(f"Evaluation split: {split}")
    print(f"Pairs evaluated: {metrics['pair_count']}")
    print()
    print("Position RMSE (km)")
    print(
        "  SGP4 baseline : "
        f"mean={metrics['baseline_position_km']['mean']:.3f} "
        f"median={metrics['baseline_position_km']['median']:.3f} "
        f"max={metrics['baseline_position_km']['max']:.3f}"
    )
    print(
        "  Residual model: "
        f"mean={metrics['model_position_km']['mean']:.3f} "
        f"median={metrics['model_position_km']['median']:.3f} "
        f"max={metrics['model_position_km']['max']:.3f}"
    )
    print()
    print("Velocity RMSE (km/s)")
    print(
        "  SGP4 baseline : "
        f"mean={metrics['baseline_velocity_kms']['mean']:.6f} "
        f"median={metrics['baseline_velocity_kms']['median']:.6f} "
        f"max={metrics['baseline_velocity_kms']['max']:.6f}"
    )
    print(
        "  Residual model: "
        f"mean={metrics['model_velocity_kms']['mean']:.6f} "
        f"median={metrics['model_velocity_kms']['median']:.6f} "
        f"max={metrics['model_velocity_kms']['max']:.6f}"
    )


def main() -> None:
    args = parse_args()
    set_seed(args.seed)
    device = resolve_device(args.device)

    if not args.checkpoint_path.exists():
        raise FileNotFoundError(f"Checkpoint not found: {args.checkpoint_path}")

    pairs = load_pairs(args.pairs_path)
    dataset = ResidualTleDataset(pairs)
    subset = make_eval_subset(dataset, args.validation_split, args.seed, args.split)
    loader = DataLoader(subset, batch_size=args.batch_size, shuffle=False)

    checkpoint = torch.load(args.checkpoint_path, map_location="cpu")
    model = ResidualMlDsgp4(
        input_dim=int(checkpoint["input_dim"]),
        hidden_size=int(checkpoint["hidden_size"]),
        max_residual=float(checkpoint.get("max_residual", 0.15)),
    ).float().to(device=device, dtype=torch.float32)
    model.load_state_dict(checkpoint["model_state_dict"])

    metrics = evaluate_model(model, loader, device)
    print_summary(metrics, args.split)


if __name__ == "__main__":
    main()
