$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

function Test-Url {
  param([Parameter(Mandatory = $true)][string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Test-Api {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8787/health" -UseBasicParsing -TimeoutSec 1
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
      return $false
    }
    $body = $response.Content | ConvertFrom-Json
    return $body.ok -eq $true -and $body.service -eq "publicalendar-api"
  } catch {
    return $false
  }
}

function Start-DevWindow {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$Command
  )

  $escapedWorkingDirectory = $WorkingDirectory.Replace("'", "''")
  $escapedTitle = $Title.Replace("'", "''")
  $script = "`$Host.UI.RawUI.WindowTitle = '$escapedTitle'; Set-Location -LiteralPath '$escapedWorkingDirectory'; $Command"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  Start-Process powershell.exe -ArgumentList "-NoExit", "-NoProfile", "-EncodedCommand", $encoded | Out-Null
}

function Stop-StaleLocalApi {
  $workers = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "workerd.exe" -and
    [string]$_.CommandLine -like "*$root*" -and
    [string]$_.CommandLine -like "*127.0.0.1:8787*"
  }
  foreach ($worker in $workers) {
    Stop-Process -Id $worker.ParentProcessId -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $worker.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if ($workers) {
    Start-Sleep -Seconds 1
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is not installed. Install Node.js 20 or newer, then run this file again."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is unavailable. Reinstall Node.js, then run this file again."
}

if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
  Write-Host "Installing dependencies for the first run..."
  & npm exec --yes pnpm@10.13.1 -- install
  if ($LASTEXITCODE -ne 0) {
    throw "Dependency installation failed."
  }
}

$apiDirectory = Join-Path $root "apps\api"
$clientDirectory = Join-Path $root "apps\client"
$wrangler = Join-Path $apiDirectory "node_modules\.bin\wrangler.cmd"
$uni = Join-Path $clientDirectory "node_modules\.bin\uni.cmd"

if (-not (Test-Path -LiteralPath $wrangler) -or -not (Test-Path -LiteralPath $uni)) {
  throw "Local dependencies are incomplete. Delete node_modules, run pnpm install, then try again."
}

if (-not (Test-Api)) {
  Stop-StaleLocalApi
  Write-Host "Preparing the local database..."
  Push-Location -LiteralPath $apiDirectory
  try {
    & $wrangler d1 migrations apply publicalendar --local
    if ($LASTEXITCODE -ne 0) {
      throw "Local database migration failed."
    }
  } finally {
    Pop-Location
  }
  $escapedWrangler = $wrangler.Replace("'", "''")
  Start-DevWindow -Title "PubliCalendar API" -WorkingDirectory $apiDirectory -Command "& '$escapedWrangler' dev --port 8787"
}

if (-not (Test-Url "http://127.0.0.1:5173")) {
  $escapedUni = $uni.Replace("'", "''")
  Start-DevWindow -Title "PubliCalendar Web" -WorkingDirectory $clientDirectory -Command "& '$escapedUni' -p h5"
}

Write-Host "Waiting for PubliCalendar to start..."
for ($attempt = 1; $attempt -le 60; $attempt += 1) {
  $apiReady = Test-Api
  $webReady = Test-Url "http://127.0.0.1:5173"
  if ($apiReady -and $webReady) {
    Start-Process "http://127.0.0.1:5173"
    Write-Host "PubliCalendar and its API are ready at http://127.0.0.1:5173"
    exit 0
  }
  Start-Sleep -Seconds 1
}

throw "The website or API did not start within 60 seconds. Check the API and Web terminal windows for errors."
