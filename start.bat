@echo off
REM Windows wrapper: double-click tu Windows Explorer de chay start.sh trong WSL.
REM Yeu cau: WSL2 + Ubuntu (hoac distro Linux khac) da setup san.

echo [start.bat] Calling WSL to run ./start.sh ...
echo.

wsl --cd "%~dp0" -- bash -c "./start.sh"

set EXITCODE=%ERRORLEVEL%
echo.
if %EXITCODE% NEQ 0 (
    echo [start.bat] FAILED with exit code %EXITCODE%
) else (
    echo [start.bat] OK
)
echo.
echo Press any key to close...
pause >nul
exit /b %EXITCODE%
