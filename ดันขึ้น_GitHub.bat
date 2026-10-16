@echo off
cd /d "%~dp0"
chcp 65001 >nul
title Push to GitHub - erp-nbcc
cls
echo ==============================================================
echo    Pushing all files to GitHub: attapon-gif/erp-nbcc
echo ==============================================================
echo.
echo If a browser window opens, please click Authorize to log in.
echo.

"C:\Users\ASUS\AppData\Local\GitHubDesktop\app-3.6.7\resources\app\git\cmd\git.exe" push -u origin main

echo.
echo ==============================================================
echo Finished! Press any key to exit...
pause >nul
