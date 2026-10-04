@echo off
REM build_mitm.bat - build mitm_cr.exe on Windows
REM
REM Default: Intel icx (most accurate libm, see benchmark/README.md); argument "cl" for MSVC.
REM IEEE semantics are required (non-finite values are tested): /fp:precise, never fast-math.

cd /d %~dp0
set CC=%1
if "%CC%"=="" set CC=icx
for /f "usebackq delims=" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set VS=%%i
if "%VS%"=="" echo Visual Studio with C++ tools not found & exit /b 1
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul
if "%CC%"=="icx" (
  set "PATH=C:\Program Files (x86)\Intel\oneAPI\compiler\2025.3\bin;%PATH%"
  set "LIB=C:\Program Files (x86)\Intel\oneAPI\compiler\2025.3\lib;%LIB%"
  icx /nologo /O3 /fp:precise /std:c++17 /EHsc mitm_cr.cpp /Fe:mitm_cr.exe
) else (
  cl /nologo /O2 /fp:precise /std:c++17 /EHsc mitm_cr.cpp /Fe:mitm_cr_cl.exe
)
if errorlevel 1 exit /b 1
echo built with %CC%
