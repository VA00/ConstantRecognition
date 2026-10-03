@echo off
REM build_benchmark.bat - build constant_gpu_benchmark.exe on Windows (for benchmark/run/run_cuda_v0.py)
REM
REM Needs the CUDA toolkit (nvcc) and Visual Studio with C++ (nvcc uses its cl.exe as host compiler).
REM Optional argument: the GPU architecture, default sm_120 (RTX 50xx); e.g. sm_89 for RTX 40xx.

cd /d %~dp0
set ARCH=%1
if "%ARCH%"=="" set ARCH=sm_120
for /f "usebackq delims=" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set VS=%%i
if "%VS%"=="" echo Visual Studio with C++ tools not found & exit /b 1
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul
nvcc -O3 -arch=%ARCH% constant_gpu_benchmark.cu -o constant_gpu_benchmark.exe
if errorlevel 1 exit /b 1
echo Built constant_gpu_benchmark.exe for %ARCH%
