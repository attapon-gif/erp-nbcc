@echo off
cd /d "%~dp0"
chcp 65001 >nul
title SMART ERPG Manual Downloader - NBC
cls
echo ==============================================================
echo    SMART ERPG Manual Downloader (ICCS / NBC)
echo ==============================================================
echo.
echo Starting download system...
echo.

"C:\Program Files\nodejs\node.exe" download_manuals.js

echo.
echo ==============================================================
echo Finished. Press any key to exit...
pause >nul
