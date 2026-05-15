# TLE Prediction

## Purpose

This directory exists to support three workflows:

1. **Historical data preparation**
   - collect historical TLE data for the same satellites across multiple timestamps
   - turn that history into old/new training pairs

2. **Model training**
   - train ML-dSGP4-based models on TLE-derived state prediction tasks
   - save the resulting checkpoint for later use

3. **Runtime inference**
   - load an already-trained model
   - accept a single TLE
   - predict forward over a requested horizon

## Folder Structure

```text
TLE_Prediction/
├── README.md
├── requirements.txt
├── predict_trajectory.py
├── build_training_pairs.py
├── train_mldsgp4_residual.py
├── fetch_spacetrack_history.sh
├── cache/
│   └── training_pairs.jsonl
├── data/
│   ├── 100_most_recent_satellites.csv
│   ├── 88_most_recent_satellites_LEO.csv
│   ├── enriched_with_missions.csv
│   └── spacetrack_history_*.csv
└── models/
    └── mldsgp4_best_model.pth
```

## Key Files

### `predict_trajectory.py`

Runtime inference script used by the web app.

It:
- loads a trained model
- accepts one TLE via command-line arguments
- predicts forward in time
- returns JSON samples containing position and velocity state vectors

This is the script called by:
- `src/lib/server/tlePrediction.ts`
- `src/routes/api/tle-prediction/+server.ts`

### `build_training_pairs.py`

Builds supervised old/new same-satellite training pairs.

It:
- reads a historical CSV
- groups rows by `satellite_number`
- sorts each satellite by epoch
- emits consecutive `old -> new` examples into `cache/training_pairs.jsonl`

### `train_mldsgp4_residual.py`

Improved training script for a **residual** model.

Instead of predicting full absolute orbital state directly, it:
- uses SGP4 as the physical baseline
- learns the residual correction from baseline to target state

### `fetch_spacetrack_history.sh`

Downloads historical GP/TLE data from Space-Track for the NORAD IDs in the current dataset.

It:
- reads `satellite_number` values from a source CSV
- logs into Space-Track
- downloads `gp_history` for those NORAD IDs over a configurable time window
- writes a historical CSV that can be used for training-pair generation

## Data Files

### `data/88_most_recent_satellites_LEO.csv`

Current live Warpcore LEO-focused dataset used by the app.

Use case:
- frontend display

### `data/100_most_recent_satellites.csv`

Snapshot dataset similar in structure to the 88-row file.

### `data/enriched_with_missions.csv`

Enriched catalog with satellite names, type metadata, and summary text.

### `data/spacetrack_history_*.csv`

Recommended place for downloaded Space-Track history exports.

## Models

### `models/mldsgp4_best_model.pth`

Current runtime model checkpoint used by the app.

### Recommended workflow

1. Download historical data from Space-Track

```bash
export ST_USERNAME='your_spacetrack_username'
export ST_PASSWORD='your_spacetrack_password'

./fetch_spacetrack_history.sh 90 data/spacetrack_history_90d.csv
```

2. Build training pairs from that historical file

```bash
python3 build_training_pairs.py --data-path data/spacetrack_history_90d.csv
```

3. Train the residual model

```bash
python3 train_mldsgp4_residual.py
```
