@echo off
setlocal

REM Avatar Companion quick launcher for Windows.
REM - Creates .venv if missing
REM - Installs dependencies
REM - Creates .env from .env.example if missing
REM - Starts FastAPI with auto-reload

cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python was not found in PATH.
  echo Install Python 3.10+ and re-run this file.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [INFO] Creating virtual environment...
  python -m venv .venv
  if errorlevel 1 (
    echo [ERROR] Failed to create virtual environment.
    pause
    exit /b 1
  )
)

call ".venv\Scripts\activate.bat"
if errorlevel 1 (
  echo [ERROR] Failed to activate virtual environment.
  pause
  exit /b 1
)

echo [INFO] Installing/updating dependencies...
python -m pip install --upgrade pip >nul
pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] Dependency installation failed.
  pause
  exit /b 1
)

if not exist ".env" (
  echo [INFO] Creating .env from .env.example...
  copy /Y ".env.example" ".env" >nul
  echo [ACTION REQUIRED] Open .env and set OPENAI_API_KEY.
)

echo.
echo [INFO] Starting Avatar Companion at http://127.0.0.1:8000
echo [INFO] Press Ctrl+C to stop.
echo.

uvicorn app:app --reload --host 127.0.0.1 --port 8000

endlocal
