$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js was not found. Install Node.js 18 or later and try again.' -ForegroundColor Red
  exit 1
}

Write-Host 'Starting SYNTHNET (run this as Administrator)...' -ForegroundColor Cyan
& node server.js 2>&1 | ForEach-Object {
  $line = $_.ToString()
  $color = 'Gray'
  switch -Regex ($line) {
    '(?i)\b(error|failed|cannot start|gate_required)\b' { $color = 'Red'; break }
    '(?i)\[gate\]\s+OFF|\bwarn(ing)?\b|disabled until' { $color = 'Yellow'; break }
    '\[auth\]|\[pay\].*unlocked|\[gate\]\s+ACTIVE' { $color = 'Green'; break }
    '\[gate\]|\[reconnect\]|portal ->|Admin dashboard' { $color = 'Cyan'; break }
  }
  Write-Host $line -ForegroundColor $color
}

$nodeExitCode = $LASTEXITCODE
exit $nodeExitCode
