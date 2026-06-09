$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

Push-Location $backend
try {
  npm run build
} finally {
  Pop-Location
}

Push-Location $frontend
try {
  npm run build
} finally {
  Pop-Location
}

$env:NODE_ENV = "production"
$env:HOST = "127.0.0.1"
if (-not $env:PORT) {
  $env:PORT = "8787"
}
$env:FRONTEND_DIST_DIR = Join-Path $frontend "dist"

Push-Location $backend
try {
  node dist/server.js
} finally {
  Pop-Location
}
