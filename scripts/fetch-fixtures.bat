@echo off
:: fetch-fixtures.bat
:: Called by Windows Task Scheduler every Monday at 7am.
:: Logs output to fetch-fixtures.log in the same folder.

set SCRIPT_DIR=%~dp0
set LOG_FILE=%SCRIPT_DIR%fetch-fixtures.log

echo. >> "%LOG_FILE%"
echo ========================================= >> "%LOG_FILE%"
echo Started: %DATE% %TIME% >> "%LOG_FILE%"
echo ========================================= >> "%LOG_FILE%"

node "%SCRIPT_DIR%fetch-fixtures.js" >> "%LOG_FILE%" 2>&1

if %ERRORLEVEL% EQU 0 (
  echo Success >> "%LOG_FILE%"
) else (
  echo FAILED with error code %ERRORLEVEL% >> "%LOG_FILE%"
)
