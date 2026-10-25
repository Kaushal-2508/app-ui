@echo off
REM ============================================================
REM  Build the SALCI Olympiad brochure PDF from the HTML source.
REM  Edit text in  salci-olympiad-brochure.html  then double-click
REM  this file. The PDF is written to  out\salci-olympiad-brochure.pdf
REM ============================================================
setlocal
cd /d "%~dp0"

set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"

set "SRC=%~dp0salci-olympiad-brochure.html"
set "OUT=%~dp0out\salci-olympiad-brochure.pdf"
set "UDD=%TEMP%\edge_brochure_pdf"

if not exist "%EDGE%" (
  echo.
  echo  Could not find Microsoft Edge. PDF not built.
  echo.
  pause
  exit /b 1
)

echo.
echo  Building brochure PDF from salci-olympiad-brochure.html ...
echo.

REM Run twice: the first warms up Edge, the second writes the final PDF
"%EDGE%" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="%OUT%" --user-data-dir="%UDD%" "%SRC%" >nul 2>&1
"%EDGE%" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="%OUT%" --user-data-dir="%UDD%" "%SRC%" >nul 2>&1

if exist "%OUT%" (
  echo  DONE.  Saved to:  out\salci-olympiad-brochure.pdf
  echo  Opening it now...
  start "" "%OUT%"
) else (
  echo  FAILED to build the PDF.
)
echo.
pause
