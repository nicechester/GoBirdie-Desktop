@echo off
setlocal enabledelayedexpansion

:: ── Get target triple ────────────────────────────────────────────────────────
for /f "tokens=2" %%i in ('rustc -vV ^| findstr /b "host:"') do set TARGET_TRIPLE=%%i
echo Target: %TARGET_TRIPLE%

:: ── 1. Compile Windows WPD helper ────────────────────────────────────────────
echo =^> Building garmin_mtp_windows...

set WIN_SRC=src-tauri\src\native\garmin_mtp_windows.cpp
set WIN_OUT=src-tauri\src\native\garmin_mtp_windows-%TARGET_TRIPLE%.exe

:: Find vcvars64.bat — try common VS 2022 locations
set VCVARS=
for %%p in (
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
    "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat"
    "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
    "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
) do (
    if exist %%p set VCVARS=%%p
)

if "%VCVARS%"=="" (
    echo ERROR: Could not find vcvars64.bat. Install Visual Studio 2022 with C++ workload.
    exit /b 1
)

call "%VCVARS%"

cl /W3 /EHsc /Fe:"%WIN_OUT%" "%WIN_SRC%" ^
    /link Propsys.lib PortableDeviceGuids.lib Ole32.lib oleaut32.lib
if errorlevel 1 (
    echo ERROR: Failed to compile garmin_mtp_windows
    exit /b 1
)
echo     %WIN_OUT% built

:: ── 2. Create binary placeholders (required by Tauri externalBin) ───────
echo =^> Creating binary placeholders for Tauri...
set MAC_PLACEHOLDER=src-tauri\src\native\garmin_mtp-%TARGET_TRIPLE%.exe
if not exist "%MAC_PLACEHOLDER%" type nul > "%MAC_PLACEHOLDER%"

set SYNC_PLACEHOLDER=src-tauri\src\native\gobirdie-sync-helper-%TARGET_TRIPLE%.exe
if not exist "%SYNC_PLACEHOLDER%" type nul > "%SYNC_PLACEHOLDER%"

:: ── 3. JS deps + Tauri build ─────────────────────────────────────────────────
echo =^> Installing JS dependencies...
call npm install
if errorlevel 1 exit /b 1

echo =^> Building Tauri app...
call npm run tauri:build
if errorlevel 1 exit /b 1

echo.
echo Done. MSI: src-tauri\target\release\bundle\msi\
