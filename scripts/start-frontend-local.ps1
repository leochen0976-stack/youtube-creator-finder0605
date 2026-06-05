$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $projectRoot
$nodeDir = Join-Path $workspaceRoot "node-v22.13.1-win-x64"
$env:PATH = "$nodeDir;$env:PATH"

Set-Location (Join-Path $projectRoot "frontend")
& (Join-Path $nodeDir "npm.cmd") run dev -- --host 127.0.0.1
