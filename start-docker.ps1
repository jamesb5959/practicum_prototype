param(
  [ValidateSet("up", "down", "reset")]
  [string]$Action
)

$ErrorActionPreference = "Stop"

if (-not $Action) {
  Write-Host "Usage: .\start-docker.ps1 {up|down|reset}"
  Write-Host "  up    -> start app, Keycloak, and Postgres"
  Write-Host "  down  -> stop containers"
  Write-Host "  reset -> stop containers and remove volumes"
  exit 1
}

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

function Ensure-EnvFiles {
  if (-not (Test-Path ".env.docker")) {
    throw "Missing .env.docker. Run .\setup-docker.ps1 first."
  }

  if (-not (Test-Path "keycloak-server/.env")) {
    throw "Missing keycloak-server/.env. Run .\setup-docker.ps1 first."
  }

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
}

function Get-LocalIp {
  $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric |
    Select-Object -First 1

  if ($route) {
    $address = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -ne "127.0.0.1" } |
      Select-Object -First 1
    if ($address) {
      return $address.IPAddress
    }
  }

  $fallback = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } |
    Select-Object -First 1

  if ($fallback) {
    return $fallback.IPAddress
  }

  return $null
}

function Check-PortConflict {
  $lines = docker ps --format "{{.Names}} {{.Ports}}"
  foreach ($line in $lines) {
    if ($line -match "0\.0\.0\.0:8080->|:::8080->") {
      $name = $line.Split(" ")[0]
      if ($name -ne "practicum-keycloak") {
        throw "Port 8080 is already in use by container: $name`nStop that container first, or run .\start-docker.ps1 down if it belongs to another practicum stack."
      }
    }
  }
}

Ensure-EnvFiles

switch ($Action) {
  "up" {
    Check-PortConflict
    docker compose -f docker-compose.full.yml up -d
    $localIp = Get-LocalIp
    Write-Host "Docker stack started."
    Write-Host "App: http://localhost:5173"
    Write-Host "Keycloak: http://localhost:8080"
    if ($localIp) {
      Write-Host "LAN App: http://${localIp}:5173"
      Write-Host "LAN Keycloak: http://${localIp}:8080"
    }
  }
  "down" {
    docker compose -f docker-compose.full.yml down
  }
  "reset" {
    docker compose -f docker-compose.full.yml down -v
  }
}
