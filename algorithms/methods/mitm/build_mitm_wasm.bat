@echo off
REM build_mitm_wasm.bat - build the meet-in-the-middle search for the web page (calculator_frontend, page app/mitm)
REM
REM Writes mitm.js and mitm.wasm into calculator_frontend\public\wasm\ (build artifacts, not in git).
REM Needs Emscripten: run emsdk_env.ps1 or emsdk_env.bat from the emsdk directory first (see C\compile.bat).
REM The same command works elsewhere, e.g. from this directory on Linux or macOS:
REM   em++ -O3 -std=c++17 mitm_wasm.cpp -s ALLOW_MEMORY_GROWTH=1 -s MAXIMUM_MEMORY=4GB ^
REM        -s EXPORTED_FUNCTIONS="['_mitm_build','_mitm_search','_free']" ^
REM        -s EXPORTED_RUNTIME_METHODS="['ccall','UTF8ToString']" -o ../../../calculator_frontend/public/wasm/mitm.js

cd /d %~dp0
where em++ >nul 2>&1
if errorlevel 1 echo em++ not found. Run emsdk_env.ps1 or emsdk_env.bat from your emsdk directory first.
if errorlevel 1 exit /b 1
em++ -O3 -std=c++17 mitm_wasm.cpp -s ALLOW_MEMORY_GROWTH=1 -s MAXIMUM_MEMORY=4GB -s EXPORTED_FUNCTIONS="['_mitm_build','_mitm_search','_free']" -s EXPORTED_RUNTIME_METHODS="['ccall','UTF8ToString']" -o ../../../calculator_frontend/public/wasm/mitm.js
if errorlevel 1 exit /b 1
echo Built calculator_frontend\public\wasm\mitm.js and mitm.wasm
