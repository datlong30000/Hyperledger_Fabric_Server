@echo off
REM Windows wrapper: double-click tu Windows Explorer de chay stop.sh trong WSL.
REM Pass-through args: stop.bat --purge -> stop.sh --purge

echo [stop.bat] Calling WSL to run ./stop.sh %* ...
echo.

wsl --cd "%~dp0" -- bash -lc "./stop.sh %*"

set EXITCODE=%ERRORLEVEL%
echo.
if %EXITCODE% NEQ 0 (
    echo [stop.bat] FAILED with exit code %EXITCODE%
) else (
    echo [stop.bat] OK
)
echo.
echo Press any key to close...
pause >nul
exit /b %EXITCODE%
