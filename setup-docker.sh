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
MODEL_PATH="TLE_Prediction/models/mldsgp4_best_model_improved.pth"
TEXTURE_PATH="static/textures/earth.jpg"
SKYBOX_DIR="static/skybox"
SKYBOX_FILES=(px.jpg nx.jpg py.jpg ny.jpg pz.jpg nz.jpg)

echo "Ensuring project directories exist..."
mkdir -p TLE_Prediction/cache TLE_Prediction/data keycloak-server static/skybox

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
  echo "Add the texture file before running the Docker stack."
  exit 1
fi

echo "Checking skybox images..."
for f in "${SKYBOX_FILES[@]}"; do
  if [ ! -f "$SKYBOX_DIR/$f" ]; then
    echo "Missing skybox face: $SKYBOX_DIR/$f"
    echo "Place 6 faces named px.jpg nx.jpg py.jpg ny.jpg pz.jpg nz.jpg in $SKYBOX_DIR before building."
    exit 1
  fi
done

if [ ! -f ".env.docker" ]; then
  echo "Creating .env.docker from .env.docker.example..."
  cp .env.docker.example .env.docker
fi

if ! grep -q '^KEYCLOAK_DIRECT_LOGIN=' .env.docker; then
  echo "Adding KEYCLOAK_DIRECT_LOGIN=false to .env.docker..."
  printf '\nKEYCLOAK_DIRECT_LOGIN=false\n' >> .env.docker
fi

if [ ! -f "keycloak-server/.env" ]; then
  echo "Creating keycloak-server/.env from keycloak-server/.env.example..."
  cp keycloak-server/.env.example keycloak-server/.env
fi

echo "Syncing Cesium static assets..."
node scripts/sync-cesium-assets.mjs

set -a
source .env.docker
source keycloak-server/.env
set +a

COMPOSE_FILES=(-f docker-compose.full.yml)
MODE="${1:-cpu}"

if [ "$MODE" = "gpu" ]; then
  COMPOSE_FILES+=(-f docker-compose.gpu.yml)
  echo "GPU Docker mode enabled."
elif [ "$MODE" != "cpu" ]; then
  echo "Usage: ./setup-docker.sh [cpu|gpu]"
  exit 1
fi

echo "Building Docker images..."
docker compose "${COMPOSE_FILES[@]}" build

echo "Docker setup complete."
echo "Next step:"
echo "  ./start-docker.sh up ${MODE}"
