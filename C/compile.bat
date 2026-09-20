@echo off
REM compile.bat - build the WASM search engine on Windows.
REM Run it as a file from PowerShell (.\compile.bat) or cmd.exe (compile.bat);
REM its contents cannot be pasted into PowerShell, but the emcc line below can.
REM
REM Writes vsearch.js and vsearch.wasm into ..\calculator_frontend\public\wasm\
REM Same command as the `wasm` target of the Makefile. The two output files are
REM build artifacts and are not tracked in git.
REM
REM One-time installation of Emscripten (emsdk), tested in PowerShell 7:
REM   git clone https://github.com/emscripten-core/emsdk.git
REM   cd emsdk
REM   .\emsdk install latest
REM   .\emsdk activate latest
REM activate also puts emcc on the PATH of the current window.
REM
REM In every new window, first run from the emsdk directory
REM   .\emsdk_env.ps1        (PowerShell)   or   emsdk_env.bat   (cmd.exe)
REM or run `.\emsdk activate latest --permanent` once. Check: emcc --version
REM
REM Then, from this directory (<repo>\C):
REM   .\compile.bat

where emcc >nul 2>&1
if errorlevel 1 echo emcc not found. Run emsdk_env.ps1 or emsdk_env.bat from your emsdk directory first, see the comment at the top of this file.
if errorlevel 1 exit /b 1

emcc -O2 -Wall vsearch_RPN_wasm.c vsearch_RPN_core.c vsearch_RPN_complex.c utils.c -s WASM=1 -s EXPORTED_FUNCTIONS="['_search_RPN','_search_RPN_with_cr','_search_RPN_hybrid','_search_RPN_custom','_search_RPN_custom_cr','_search_RPN_complex','_evaluate_RPN_complex','_search_function_wasm','_search_batch_wasm','_free','_malloc']" -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString']" -s ALLOW_MEMORY_GROWTH=1 -o ../calculator_frontend/public/wasm/vsearch.js
if errorlevel 1 exit /b 1
echo Built ..\calculator_frontend\public\wasm\vsearch.js and vsearch.wasm
