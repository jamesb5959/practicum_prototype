#!/usr/bin/env bash
set -euo pipefail

if [ ! -f package.json ]; then
  echo "package.json not found. Run this from the project root."
  exit 1
fi

echo "Installing dependencies..."

npm install

mkdir -p static/data static/textures

echo "Downloading Earth texture..."
if command -v curl >/dev/null 2>&1; then
  tmp_texture="$(mktemp)"
  if curl -L --fail -o "$tmp_texture" \
    "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/may/world.200405.3x5400x2700.jpg"; then
    mv "$tmp_texture" static/textures/earth.jpg
  else
    echo "Download failed"
    rm -f "$tmp_texture"
  fi
else
  echo "curl not found; skipping texture download."
fi

echo "NASA LEO TLE snapshot..."
cp -f static/data/nasa-leo.sample.tle static/data/nasa-leo.tle

echo "Orbital debris TLE snapshot..."
cp -f static/data/nasa-debris.sample.tle static/data/nasa-debris.tle

echo "Setup complete."
