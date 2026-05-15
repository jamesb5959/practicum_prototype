from __future__ import annotations

import argparse
import json
import math
import platform
import random
from dataclasses import dataclass
from pathlib import Path

import dsgp4
import torch
import torch.nn as nn
from dsgp4.util import initialize_tle, propagate
from torch.utils.data import DataLoader, Dataset, random_split

torch.set_default_dtype(torch.float32)


DEFAULT_PAIRS_PATH = Path(__file__).resolve().parents[1] / "TLE_Prediction" / "cache" / "training_pairs.jsonl"
DEFAULT_OUTPUT_PATH = Path(__file__).resolve().parent / "models" / "mldsgp4_best_model_improved.pth"

NORMALIZATION_R = 6958.137
NORMALIZATION_V = 7.947155867983262
MINUTES_PER_DAY = 1440.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train an improved residual ML-dSGP4 model on old/new TLE pairs."
    )
    parser.add_argument("--pairs-path", type=Path, default=DEFAULT_PAIRS_PATH)
    parser.add_argument("--output-path", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--epochs", type=int, default=300)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--hidden-size", type=int, default=128)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-5)
    parser.add_argument("--patience", type=int, default=40)
    parser.add_argument("--validation-split", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda", "mps"], default="auto")
    return parser.parse_args()


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def resolve_device(raw: str) -> torch.device:
    if raw == "cpu":
        return torch.device("cpu")
    if raw == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA requested but not available.")
        return torch.device("cuda")
    if raw == "mps":
        if not mps_available():
            raise RuntimeError("MPS requested but not available.")
        return torch.device("mps")

    if torch.cuda.is_available():
        return torch.device("cuda")
    if platform.system() == "Darwin" and mps_available():
        return torch.device("mps")
    return torch.device("cpu")


def mps_available() -> bool:
    return bool(
        hasattr(torch.backends, "mps")
        and torch.backends.mps.is_available()
        and torch.backends.mps.is_built()
    )


def load_pairs(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        raise FileNotFoundError(f"Training pairs not found: {path}")
    pairs: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                pairs.append(json.loads(line))
    if not pairs:
        raise RuntimeError(f"No training pairs found in {path}")
    return pairs


def normalize_state(state: torch.Tensor) -> torch.Tensor:
    result = state.clone()
    result[:3] = result[:3] / NORMALIZATION_R
    result[3:] = result[3:] / NORMALIZATION_V
    return result


def tle_feature_vector(tle_obj) -> torch.Tensor:
    return torch.tensor(
        [
            float(tle_obj._ecco),
            float(tle_obj._argpo),
            float(tle_obj._inclo),
            float(tle_obj._mo),
            float(tle_obj._no_kozai),
            float(tle_obj._nodeo),
        ],
        dtype=torch.float32,
    )


def build_tle(name: str, line1: str, line2: str):
    tle = dsgp4.tle.TLE([f"0 {name}", line1, line2])
    initialize_tle(tle, with_grad=False)
    return tle


def propagate_state(tle, delta_minutes: float) -> torch.Tensor:
    state = propagate(tle, float(delta_minutes), initialized=True).reshape(-1, 6)[0].detach().cpu().float()
    return state


@dataclass
class PairSample:
    features: torch.Tensor
    baseline_norm: torch.Tensor
    target_norm: torch.Tensor
    residual_target: torch.Tensor


class ResidualTleDataset(Dataset):
    def __init__(self, pairs: list[dict[str, object]]):
        self.samples: list[PairSample] = []

        for pair in pairs:
            try:
                delta_minutes = float(pair["delta_minutes"])
                old_name = str(pair.get("old_name") or pair.get("satellite_number") or "OLD")
                new_name = str(pair.get("new_name") or pair.get("satellite_number") or "NEW")
                old_tle = build_tle(old_name, str(pair["old_line1"]), str(pair["old_line2"]))
                new_tle = build_tle(new_name, str(pair["new_line1"]), str(pair["new_line2"]))

                baseline_state = propagate_state(old_tle, delta_minutes)
                target_state = propagate_state(new_tle, 0.0)

                baseline_norm = normalize_state(baseline_state)
                target_norm = normalize_state(target_state)
                residual_target = target_norm - baseline_norm

                delta_days = delta_minutes / MINUTES_PER_DAY
                delta_orbit_scale = math.tanh(delta_days)

                features = torch.cat(
                    [
                        tle_feature_vector(old_tle),
                        baseline_norm,
                        torch.tensor([delta_days, delta_orbit_scale], dtype=torch.float32),
                    ]
                )

                self.samples.append(
                    PairSample(
                        features=features,
                        baseline_norm=baseline_norm,
                        target_norm=target_norm,
                        residual_target=residual_target,
                    )
                )
            except Exception:
                continue

        if not self.samples:
            raise RuntimeError("No valid residual training samples could be built.")

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int):
        sample = self.samples[index]
        return sample.features, sample.baseline_norm, sample.target_norm, sample.residual_target


class ResidualMlDsgp4(nn.Module):
    def __init__(self, input_dim: int, hidden_size: int = 128, max_residual: float = 0.15):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, hidden_size),
            nn.LeakyReLU(0.01),
            nn.Linear(hidden_size, hidden_size),
            nn.LeakyReLU(0.01),
            nn.Linear(hidden_size, hidden_size // 2),
            nn.LeakyReLU(0.01),
        )
        self.residual_head = nn.Linear(hidden_size // 2, 6)
        self.max_residual = max_residual

    def forward(self, features: torch.Tensor, baseline_norm: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        hidden = self.encoder(features)
        residual = torch.tanh(self.residual_head(hidden)) * self.max_residual
        prediction = baseline_norm + residual
        return prediction, residual


def make_loaders(
    dataset: ResidualTleDataset, batch_size: int, validation_split: float, seed: int
) -> tuple[DataLoader, DataLoader]:
    validation_size = max(1, int(len(dataset) * validation_split))
    training_size = max(1, len(dataset) - validation_size)
    if training_size + validation_size > len(dataset):
        validation_size = len(dataset) - training_size

    generator = torch.Generator().manual_seed(seed)
    train_set, val_set = random_split(dataset, [training_size, validation_size], generator=generator)
    return (
        DataLoader(train_set, batch_size=batch_size, shuffle=True),
        DataLoader(val_set, batch_size=batch_size, shuffle=False),
    )


def compute_loss(
    prediction: torch.Tensor,
    residual: torch.Tensor,
    target_norm: torch.Tensor,
    residual_target: torch.Tensor,
) -> tuple[torch.Tensor, dict[str, float]]:
    state_loss = nn.functional.mse_loss(prediction, target_norm)
    residual_loss = nn.functional.mse_loss(residual, residual_target)
    position_loss = nn.functional.mse_loss(prediction[:, :3], target_norm[:, :3])
    velocity_loss = nn.functional.mse_loss(prediction[:, 3:], target_norm[:, 3:])
    loss = state_loss + 0.5 * residual_loss + 0.25 * position_loss + 0.25 * velocity_loss
    return loss, {
        "state_loss": float(state_loss.detach().cpu()),
        "residual_loss": float(residual_loss.detach().cpu()),
        "position_loss": float(position_loss.detach().cpu()),
        "velocity_loss": float(velocity_loss.detach().cpu()),
    }


def evaluate(model: ResidualMlDsgp4, loader: DataLoader, device: torch.device) -> dict[str, float]:
    model.eval()
    total_loss = 0.0
    total_position_rmse_km = 0.0
    total_velocity_rmse_kms = 0.0
    total_samples = 0

    with torch.no_grad():
        for features, baseline_norm, target_norm, residual_target in loader:
            features = features.to(device)
            baseline_norm = baseline_norm.to(device)
            target_norm = target_norm.to(device)
            residual_target = residual_target.to(device)

            prediction, residual = model(features, baseline_norm)
            loss, _ = compute_loss(prediction, residual, target_norm, residual_target)

            pred_state = prediction.detach().cpu().clone()
            tgt_state = target_norm.detach().cpu().clone()
            pred_state[:, :3] *= NORMALIZATION_R
            pred_state[:, 3:] *= NORMALIZATION_V
            tgt_state[:, :3] *= NORMALIZATION_R
            tgt_state[:, 3:] *= NORMALIZATION_V

            position_rmse = torch.sqrt(torch.mean((pred_state[:, :3] - tgt_state[:, :3]) ** 2, dim=1))
            velocity_rmse = torch.sqrt(torch.mean((pred_state[:, 3:] - tgt_state[:, 3:]) ** 2, dim=1))

            batch_size = features.shape[0]
            total_loss += float(loss.detach().cpu()) * batch_size
            total_position_rmse_km += float(position_rmse.sum()) * 1.0
            total_velocity_rmse_kms += float(velocity_rmse.sum()) * 1.0
            total_samples += batch_size

    return {
        "loss": total_loss / max(1, total_samples),
        "position_rmse_km": total_position_rmse_km / max(1, total_samples),
        "velocity_rmse_kms": total_velocity_rmse_kms / max(1, total_samples),
    }


def main() -> None:
    args = parse_args()
    set_seed(args.seed)
    device = resolve_device(args.device)

    pairs = load_pairs(args.pairs_path)
    dataset = ResidualTleDataset(pairs)
    train_loader, val_loader = make_loaders(
        dataset, args.batch_size, args.validation_split, args.seed
    )

    sample_features, sample_baseline, _, _ = dataset[0]
    model = ResidualMlDsgp4(
        input_dim=sample_features.shape[0], hidden_size=args.hidden_size
    ).float().to(device=device, dtype=torch.float32)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.learning_rate, weight_decay=args.weight_decay
    )

    best_val_loss = float("inf")
    epochs_without_improvement = 0

    args.output_path.parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        model.train()
        running_loss = 0.0
        sample_count = 0

        for features, baseline_norm, target_norm, residual_target in train_loader:
            features = features.to(device)
            baseline_norm = baseline_norm.to(device)
            target_norm = target_norm.to(device)
            residual_target = residual_target.to(device)

            prediction, residual = model(features, baseline_norm)
            loss, _ = compute_loss(prediction, residual, target_norm, residual_target)

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()

            batch_size = features.shape[0]
            running_loss += float(loss.detach().cpu()) * batch_size
            sample_count += batch_size

        train_loss = running_loss / max(1, sample_count)
        metrics = evaluate(model, val_loader, device)

        print(
            f"Epoch {epoch:03d} | train_loss={train_loss:.6f} "
            f"| val_loss={metrics['loss']:.6f} "
            f"| pos_rmse_km={metrics['position_rmse_km']:.3f} "
            f"| vel_rmse_kms={metrics['velocity_rmse_kms']:.6f}"
        )

        if metrics["loss"] < best_val_loss:
            best_val_loss = metrics["loss"]
            epochs_without_improvement = 0
            torch.save(
                {
                    "model_state_dict": model.state_dict(),
                    "input_dim": sample_features.shape[0],
                    "hidden_size": args.hidden_size,
                    "max_residual": model.max_residual,
                    "normalization_R": NORMALIZATION_R,
                    "normalization_V": NORMALIZATION_V,
                    "training_metrics": metrics,
                },
                args.output_path,
            )
            print(f"Saved improved residual model to {args.output_path}")
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement >= args.patience:
                print("Early stopping triggered.")
                break


if __name__ == "__main__":
    main()
