@echo off
REM build_mitm_gpu.bat - build the Phase 2 programs on Windows (CUDA toolkit + Visual Studio with C++)
REM
REM   build_mitm_gpu.bat            mitm_gpu.exe (CUDA, -arch=sm_120 for the RTX 50xx, no FMA contraction)
REM   build_mitm_gpu.bat cpu        mitm_cr_ref.exe: mitm_cr.cpp built as in build_mitm.bat (icx /fp:precise)
REM   build_mitm_gpu.bat cpucl      mitm_cr_ref_cl.exe: the same with MSVC, the host compiler of nvcc (same libm as
REM                                 mitm_gpu.exe's host side, so a comparison isolates the GPU's math library)
REM   build_mitm_gpu.bat test       test_df64.exe (CPU) and test_df64_cuda.exe (the same tests in a CUDA kernel)
REM   build_mitm_gpu.bat fmad       mitm_gpu_fmad.exe: as mitm_gpu.exe, but nvcc may contract a*b+c into FMA
REM   build_mitm_gpu.bat bench      bench_df64.exe (generation in double vs df64) and fp_rates.exe (float vs double)
REM   build_mitm_gpu.bat ries       ries_cpu.exe (icx) and ries_gpu.exe: the search with a RIES-like command line
REM Optional second argument: the GPU architecture, default sm_120.
REM IEEE semantics are required: never fast math (no --use_fast_math, no /fp:fast).

cd /d %~dp0
set WHAT=%1
set ARCH=%2
if "%ARCH%"=="" set ARCH=sm_120
for /f "usebackq delims=" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set VS=%%i
if "%VS%"=="" echo Visual Studio with C++ tools not found & exit /b 1
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul
if "%WHAT%"=="cpu" (
  set "PATH=C:\Program Files (x86)\Intel\oneAPI\compiler\2025.3\bin;%PATH%"
  set "LIB=C:\Program Files (x86)\Intel\oneAPI\compiler\2025.3\lib;%LIB%"
  icx /nologo /O3 /fp:precise /std:c++17 /EHsc ..\mitm_cr.cpp /Fe:mitm_cr_ref.exe
) else if "%WHAT%"=="cpucl" (
  cl /nologo /O2 /fp:precise /std:c++17 /EHsc ..\mitm_cr.cpp /Fe:mitm_cr_ref_cl.exe
) else if "%WHAT%"=="test" (
  set "PATH=C:\Program Files (x86)\Intel\oneAPI\compiler\2025.3\bin;%PATH%"
  set "LIB=C:\Program Files (x86)\Intel\oneAPI\compiler\2025.3\lib;%LIB%"
  icx /nologo /O3 /fp:precise /std:c++17 /EHsc test_df64.cpp /Fe:test_df64.exe 2>nul || cl /nologo /O2 /fp:precise /std:c++17 /EHsc test_df64.cpp /Fe:test_df64.exe
  nvcc -O3 -arch=%ARCH% -std=c++17 --fmad=false -x cu test_df64.cpp -DDF64_CUDA_TEST -o test_df64_cuda.exe
) else if "%WHAT%"=="ries" (
  set "PATH=C:\Program Files (x86)\Intel\oneAPI\compiler\2025.3\bin;%PATH%"
  set "LIB=C:\Program Files (x86)\Intel\oneAPI\compiler\2025.3\lib;%LIB%"
  icx /nologo /O3 /fp:precise /std:c++17 /EHsc ries_cpu.cpp /Fe:ries_cpu.exe
  nvcc -O3 -arch=%ARCH% -std=c++17 --fmad=false -diag-suppress 20011,20014 -Xcompiler "/fp:precise /EHsc /Zc:preprocessor" ries_gpu.cu -o ries_gpu.exe
) else if "%WHAT%"=="bench" (
  nvcc -O3 -arch=%ARCH% -std=c++17 --fmad=false -diag-suppress 20011,20014 -Xcompiler "/fp:precise /EHsc /Zc:preprocessor" bench_df64.cu -o bench_df64.exe
  nvcc -O3 -arch=%ARCH% -std=c++17 fp_rates.cu -o fp_rates.exe
) else if "%WHAT%"=="fmad" (
  nvcc -O3 -arch=%ARCH% -std=c++17 --fmad=true -diag-suppress 20011,20014 -Xcompiler "/fp:precise /EHsc /Zc:preprocessor" mitm_cuda.cu -o mitm_gpu_fmad.exe
) else (
  nvcc -O3 -arch=%ARCH% -std=c++17 --fmad=false -diag-suppress 20011,20014 -Xcompiler "/fp:precise /EHsc /Zc:preprocessor" mitm_cuda.cu -o mitm_gpu.exe
)
if errorlevel 1 exit /b 1
echo built %WHAT%
