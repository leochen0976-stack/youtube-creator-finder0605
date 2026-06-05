@echo off
set "PROJECT_ROOT=%~dp0.."
for %%I in ("%PROJECT_ROOT%\..") do set "WORKSPACE_ROOT=%%~fI"
set "NODE_DIR=%WORKSPACE_ROOT%\node-v22.13.1-win-x64"
set "PATH=%NODE_DIR%;%PATH%"
cd /d "%PROJECT_ROOT%\frontend"
"%NODE_DIR%\npm.cmd" run dev -- --host 127.0.0.1
