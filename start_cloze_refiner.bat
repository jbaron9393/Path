@echo off
cd /d "%~dp0"

REM Kill any old node servers silently
taskkill /F /IM node.exe >nul 2>&1

REM Start fresh with the integrated v4 cloze pipeline
start "" /B node scripts/run-v4.mjs

REM Small wait
ping 127.0.0.1 -n 2 >nul

REM Open browser
start "" http://localhost:3000/
