#!/usr/bin/env bash
set -euo pipefail

if [ ! -f package.json ]; then
  echo "package.json not found. Run this from the project root."
  exit 1
fi

echo "Installing dependencies..."

npm install

echo "Ensuring Cesium compatibility..."

npm install @zip.js/zip.js@2.6.63 --save-exact

mkdir -p static/data static/textures

echo "Downloading Earth texture..."
if command -v curl >/dev/null 2>&1; then
  tmp_texture="$(mktemp)"
  if curl -L --fail -o "$tmp_texture" \
    #broken
    #"https://svs.gsfc.nasa.gov/vis/a010000/a012500/a012564/frames/5400x2700_2x1_60p/world.topo.2004-04.png"; then
    "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/may/world.200405.3x5400x2700.jpg"; then
    mv "$tmp_texture" static/textures/earth.png
  else
    echo "Download failed"
    rm -f "$tmp_texture"
  fi
else
  echo "Error :("
fi

echo "NASA LEO TLE snapshot..."
cp -f static/data/nasa-leo.sample.tle static/data/nasa-leo.tle

echo "Setup complete."
