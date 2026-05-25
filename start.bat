@echo off
title VOTRI CLUB - Backend
cd /d "%~dp0"
set DEV=1

REM #region agent log
node -e "require('fs').appendFileSync('debug-d15afd.log',JSON.stringify({sessionId:'d15afd',hypothesisId:'A',location:'start.bat:entry',message:'start.bat begun',data:{cwd:process.cwd()},timestamp:Date.now()})+'\n')" 2>nul
REM #endregion

echo.
echo  VOTRI CLUB - khoi dong server port 3000
echo  Mo trinh duyet: http://localhost:3000
echo  Can XAMPP MySQL dang chay
echo.

REM Giai phong port 3000 neu server cu con chay
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    echo  Dang tat process cu tren port 3000 PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

REM Dung node truc tiep — KHONG dung PowerShell Set-Content len app.js (hong UTF-8)
node server.js
set NODE_EXIT=%ERRORLEVEL%

REM #region agent log
node -e "require('fs').appendFileSync('debug-d15afd.log',JSON.stringify({sessionId:'d15afd',hypothesisId:'C',location:'start.bat:exit',message:'node server.js finished',data:{exitCode:parseInt(process.env.NODE_EXIT||'0',10)},timestamp:Date.now()})+'\n')" 2>nul
REM #endregion

if %NODE_EXIT% neq 0 (
    echo.
    echo  Loi khoi dong. Thu: netstat -ano ^| findstr :3000
    pause
)
