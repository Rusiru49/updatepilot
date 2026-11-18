@echo off
title UpdatePilot launcher
echo Starting UpdatePilot (production mode)...
start "UpdatePilot API" cmd /k "cd /d %~dp0api && npm start"
start "UpdatePilot Web" cmd /k "cd /d %~dp0web && npm start"
echo Waiting for the servers to start...
timeout /t 10 /nobreak >nul
start "" http://localhost:3000
echo Done. Close the "UpdatePilot API" and "UpdatePilot Web" windows to stop.