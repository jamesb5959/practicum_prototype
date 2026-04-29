#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [ ! -f package.json ]; then
  echo "package.json not found. Run this from the project root."
  exit 1
fi

WARPCORE_DATASET="static/data/88_most_recent_satellites_LEO.csv"
PREDICTION_DATASET="TLE_Prediction/data/88_most_recent_satellites_LEO.csv"
MODEL_PATH="TLE_Prediction/models/mldsgp4_best_model.pth"
TEXTURE_PATH="static/textures/earth.jpg"

echo "Installing Node dependencies..."
npm install

echo "Syncing Cesium static assets..."
node scripts/sync-cesium-assets.mjs

echo "Ensuring project directories exist..."
mkdir -p static/data static/textures TLE_Prediction/cache TLE_Prediction/data TLE_Prediction/models

echo "Checking required live dataset..."
if [ ! -f "$WARPCORE_DATASET" ]; then
  echo "Missing live dataset: $WARPCORE_DATASET"
  exit 1
fi

echo "Checking prediction dataset copy..."
if [ ! -f "$PREDICTION_DATASET" ]; then
  echo "Prediction dataset copy missing. Copying from live dataset..."
  cp "$WARPCORE_DATASET" "$PREDICTION_DATASET"
fi

echo "Checking prediction model..."
if [ ! -f "$MODEL_PATH" ]; then
  echo "Missing prediction model: $MODEL_PATH"
  exit 1
fi

echo "Checking globe texture..."
if [ ! -f "$TEXTURE_PATH" ]; then
  echo "Missing globe texture: $TEXTURE_PATH"
  echo "Add the texture file before running the app."
  exit 1
fi

echo "Installing Python dependencies for TLE_Prediction..."
python3 -m pip install -r TLE_Prediction/requirements.txt

<<<<<<< HEAD
echo "Setup complete."
=======
echo "Setup complete."
echo "Next steps:"
echo "  1. Start Keycloak: cd keycloak-server && cp .env.example .env && docker compose up -d"
echo "  2. Start the app: ./start.sh"
>>>>>>> d2690bf3e35508a9ba14fbe18b50a4131de75302
