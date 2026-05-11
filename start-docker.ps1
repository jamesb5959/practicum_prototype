param(
  [ValidateSet("up", "down", "reset")]
  [string]$Action,
  [ValidateSet("cpu", "gpu")]
  [string]$Mode = "cpu",
  [ValidateSet("normal", "performance")]
  [string]$Profile = "normal"
)

$ErrorActionPreference = "Stop"

if (-not $Action) {
  Write-Host "Usage: .\start-docker.ps1 {up|down|reset} [cpu|gpu] [normal|performance]"
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

function Set-EnvKey {
  param(
    [string]$Path,
    [string]$Key,
    [string]$Value
  )

  $content = if (Test-Path $Path) { Get-Content $Path } else { @() }
  $updated = $false
  $next = foreach ($line in $content) {
    if ($line -match "^$Key=") {
      $updated = $true
      "$Key=$Value"
    } else {
      $line
    }
  }

  if (-not $updated) {
    $next += "$Key=$Value"
  }

  Set-Content -Path $Path -Value $next
}

function Invoke-NativeQuiet {
  param(
    [string]$Command,
    [string[]]$Arguments
  )

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Command @Arguments 1>$null 2>$null
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Invoke-NativeOutput {
  param(
    [string]$Command,
    [string[]]$Arguments
  )

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $Command @Arguments 2>&1
    return @{
      ExitCode = $LASTEXITCODE
      Output = $output
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Escape-ShellSingleQuoted {
  param([string]$Value)
  return $Value.Replace("'", "'\''")
}

function Sync-KeycloakClient {
  $realm = if ($env:KEYCLOAK_REALM) { $env:KEYCLOAK_REALM } else { "demo" }
  $clientId = if ($env:KEYCLOAK_CLIENT_ID) { $env:KEYCLOAK_CLIENT_ID } else { "svelte-web" }
  $appBaseUrl = if ($env:APP_BASE_URL) { $env:APP_BASE_URL } else { "http://localhost:5174" }
  $adminUser = if ($env:KEYCLOAK_ADMIN) { $env:KEYCLOAK_ADMIN } else { "admin" }
  $adminPassword = if ($env:KEYCLOAK_ADMIN_PASSWORD) { $env:KEYCLOAK_ADMIN_PASSWORD } else { "Admin123!" }

  $loggedIn = $false
  for ($i = 0; $i -lt 30; $i++) {
    $loginExitCode = Invoke-NativeQuiet "docker" @(
      "exec", "practicum-keycloak",
      "/opt/keycloak/bin/kcadm.sh", "config", "credentials",
      "--server", "http://localhost:8080",
      "--realm", "master",
      "--user", $adminUser,
      "--password", $adminPassword
    )
    if ($loginExitCode -eq 0) {
      $loggedIn = $true
      break
    }
    Start-Sleep -Seconds 2
  }

  if (-not $loggedIn) {
    Write-Warning "Could not log into Keycloak to sync client redirect settings."
    return
  }

  $lookupResult = Invoke-NativeOutput "docker" @(
    "exec", "practicum-keycloak",
    "/opt/keycloak/bin/kcadm.sh", "get", "clients",
    "-r", $realm,
    "-q", "clientId=$clientId",
    "--fields", "id"
  )
  $lookupOutput = ($lookupResult.Output | ForEach-Object { "$_" }) -join "`n"
  $clientMatch = [regex]::Match($lookupOutput, '"id"\s*:\s*"([^"]+)"')
  $clientUuid = if ($clientMatch.Success) { $clientMatch.Groups[1].Value } else { $null }
  if ($lookupResult.ExitCode -ne 0 -or -not $clientUuid) {
    Write-Warning "Could not find Keycloak client '$clientId' in realm '$realm'."
    if ($lookupOutput) {
      Write-Warning $lookupOutput
    }
    return
  }

  $redirectUris = 'redirectUris=[\"' + $appBaseUrl + '/*\"]'
  $webOrigins = 'webOrigins=[\"' + $appBaseUrl + '\"]'
  $updateResult = Invoke-NativeOutput "docker" @(
    "exec", "practicum-keycloak",
    "/opt/keycloak/bin/kcadm.sh", "update", "clients/$clientUuid",
    "-r", $realm,
    "-s", "rootUrl=$appBaseUrl",
    "-s", $redirectUris,
    "-s", $webOrigins
  )
  if ($updateResult.ExitCode -ne 0) {
    Write-Warning "Could not update Keycloak redirect settings for '$clientId'."
    if ($updateResult.Output) {
      Write-Warning ($updateResult.Output -join "`n")
    }
    return
  }

  Write-Host "Keycloak client '$clientId' redirect settings synced to $appBaseUrl."
}

Ensure-EnvFiles

if ($Mode -eq "gpu") {
  $composeFiles = @("-f", "docker-compose.full.yml", "-f", "docker-compose.gpu.yml")
} else {
  $composeFiles = @("-f", "docker-compose.full.yml")
}

switch ($Action) {
  "up" {
    Check-PortConflict
    if ($Profile -eq "performance") {
      Set-EnvKey -Path ".env.docker" -Key "PUBLIC_DEMO_PERFORMANCE_MODE" -Value "true"
      Write-Host "Demo performance mode enabled."
    } else {
      Set-EnvKey -Path ".env.docker" -Key "PUBLIC_DEMO_PERFORMANCE_MODE" -Value "false"
    }
    Ensure-EnvFiles
    if ($Mode -eq "gpu") {
      Write-Host "GPU Docker mode enabled."
    }
    docker compose @composeFiles up -d
    Sync-KeycloakClient
    $localIp = Get-LocalIp
    Write-Host "Docker stack started."
    Write-Host "App: http://localhost:5174"
    Write-Host "Keycloak: http://localhost:8080"
    if ($localIp) {
      Write-Host "LAN App: http://${localIp}:5174"
      Write-Host "LAN Keycloak: http://${localIp}:8080"
    }
  }
  "down" {
    docker compose @composeFiles down
  }
  "reset" {
    docker compose @composeFiles down -v
  }
}
