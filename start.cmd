@echo off
rem Double-click to check, install and open Aftertake with its recorded examples.
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Aftertake needs Node.js 22 or newer. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)
node scripts\aftertake.mjs --examples %*
if errorlevel 1 pause
