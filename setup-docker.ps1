param(
  [ValidateSet("cpu", "gpu")]
  [string]$Mode = "cpu"
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

if (-not (Test-Path "package.json")) {
  Write-Error "package.json not found. Run this from the project root."
}

$WarpcoreDataset = "static/data/88_most_recent_satellites_LEO.csv"
$PredictionDataset = "TLE_Prediction/data/88_most_recent_satellites_LEO.csv"
$ModelPath = "TLE_Prediction/models/mldsgp4_best_model_improved.pth"
$TexturePath = "static/textures/earth.jpg"
$SkyboxDir = "static/skybox"
$SkyboxFiles = @("px.jpg", "nx.jpg", "py.jpg", "ny.jpg", "pz.jpg", "nz.jpg")

Write-Host "Ensuring project directories exist..."
New-Item -ItemType Directory -Force -Path "TLE_Prediction/cache" | Out-Null
New-Item -ItemType Directory -Force -Path "TLE_Prediction/data" | Out-Null
New-Item -ItemType Directory -Force -Path "keycloak-server" | Out-Null
New-Item -ItemType Directory -Force -Path $SkyboxDir | Out-Null

Write-Host "Checking required live dataset..."
if (-not (Test-Path $WarpcoreDataset)) {
  Write-Error "Missing live dataset: $WarpcoreDataset"
}

Write-Host "Checking prediction dataset copy..."
if (-not (Test-Path $PredictionDataset)) {
  Write-Host "Prediction dataset copy missing. Copying from live dataset..."
  Copy-Item $WarpcoreDataset $PredictionDataset
}

Write-Host "Checking prediction model..."
if (-not (Test-Path $ModelPath)) {
  Write-Error "Missing prediction model: $ModelPath"
}

Write-Host "Checking globe texture..."
if (-not (Test-Path $TexturePath)) {
  Write-Error "Missing globe texture: $TexturePath`nAdd the texture file before running the Docker stack."
}

Write-Host "Checking skybox images..."
foreach ($file in $SkyboxFiles) {
  $path = Join-Path $SkyboxDir $file
  if (-not (Test-Path $path)) {
    Write-Error "Missing skybox face: $path`nPlace 6 faces named px.jpg nx.jpg py.jpg ny.jpg pz.jpg nz.jpg in $SkyboxDir before building."
  }
}

if (-not (Test-Path ".env.docker")) {
  Write-Host "Creating .env.docker from .env.docker.example..."
  Copy-Item ".env.docker.example" ".env.docker"
}

$dockerEnvText = Get-Content ".env.docker" -Raw
if ($dockerEnvText -notmatch "(?m)^KEYCLOAK_DIRECT_LOGIN=") {
  Write-Host "Adding KEYCLOAK_DIRECT_LOGIN=false to .env.docker..."
  Add-Content ".env.docker" "`nKEYCLOAK_DIRECT_LOGIN=false"
}

if (-not (Test-Path "keycloak-server/.env")) {
  Write-Host "Creating keycloak-server/.env from keycloak-server/.env.example..."
  Copy-Item "keycloak-server/.env.example" "keycloak-server/.env"
}

Write-Host "Syncing Cesium static assets..."
node scripts/sync-cesium-assets.mjs

Get-Content ".env.docker" | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $parts = $_ -split '=', 2
  [System.Environment]::SetEnvironmentVariable($parts[0], $parts[1], "Process")
}

Get-Content "keycloak-server/.env" | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $parts = $_ -split '=', 2
  [System.Environment]::SetEnvironmentVariable($parts[0], $parts[1], "Process")
}

if ($Mode -eq "gpu") {
  Write-Host "GPU Docker mode enabled."
  $composeFiles = @("-f", "docker-compose.full.yml", "-f", "docker-compose.gpu.yml")
} else {
  $composeFiles = @("-f", "docker-compose.full.yml")
}

Write-Host "Building Docker images..."
docker compose @composeFiles build

Write-Host "Docker setup complete."
Write-Host "Next step:"
Write-Host "  .\start-docker.ps1 up $Mode"
