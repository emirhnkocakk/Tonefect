@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === NEGANS VISION: temizlik + exe olusturma ===
echo.

echo [1/4] Gereksiz dosyalar siliniyor...
for %%F in (app.py NegansVision_klasik.bat oturum.json queue.csv texts.txt requirements_eski.txt) do if exist "%%F" del /q "%%F"
if exist "__pycache__" rmdir /s /q "__pycache__"
if exist "build" rmdir /s /q "build"
if exist "NegansVision.spec" del /q "NegansVision.spec"

echo [2/4] Paketler kuruluyor...
python -m pip install --quiet -r requirements.txt pyinstaller
if errorlevel 1 goto hata

echo [3/4] exe olusturuluyor (1-3 dakika surebilir)...
python -m PyInstaller --noconfirm --clean --onedir --noconsole --name NegansVision server.py
if errorlevel 1 goto hata

echo [4/4] Dosyalar exe'nin yanina kopyalaniyor...
xcopy /e /i /y /q "web" "dist\NegansVision\web" >nul
xcopy /e /i /y /q "fonts" "dist\NegansVision\fonts" >nul
copy /y "brand.json" "dist\NegansVision\brand.json" >nul

rmdir /s /q "build" 2>nul
del /q "NegansVision.spec" 2>nul

echo.
echo TAMAM!  Uygulama: %~dp0dist\NegansVision\NegansVision.exe
echo Bu klasoru (dist\NegansVision) istedigin yere tasiyabilirsin; masaustune kisayol olusturabilirsin.
echo.
pause
exit /b 0

:hata
echo.
echo HATA olustu. Yukaridaki mesaji kontrol et.
pause
exit /b 1
