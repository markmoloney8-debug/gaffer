@echo off
:: update-results.bat
:: Called by Windows Task Scheduler every hour.
:: Logs output to update-results.log in the same folder.

set SCRIPT_DIR=%~dp0
set LOG_FILE=%SCRIPT_DIR%update-results.log

echo. >> "%LOG_FILE%"
echo ========================================= >> "%LOG_FILE%"
echo Started: %DATE% %TIME% >> "%LOG_FILE%"
echo ========================================= >> "%LOG_FILE%"

cd /d "%SCRIPT_DIR%"
node "%SCRIPT_DIR%update-results.js" >> "%LOG_FILE%" 2>&1

if %ERRORLEVEL% EQU 0 (
  echo Success >> "%LOG_FILE%"
) else (
  echo FAILED with error code %ERRORLEVEL% >> "%LOG_FILE%"
)
