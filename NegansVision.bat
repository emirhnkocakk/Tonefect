@echo off
cd /d "%~dp0"
python -c "import PIL, numpy" 2>nul
if errorlevel 1 python -m pip install -r requirements.txt
where pythonw >nul 2>nul
if errorlevel 1 (
  python server.py
) else (
  start "" pythonw server.py
)
