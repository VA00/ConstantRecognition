#!/bin/bash
# machine_info.sh - the machine record for PHASE2_RESULTS.md: CPU, cores, RAM, OS, compilers, GPU and driver
#
# Author: Andrzej Odrzywolek
# Date: October 4, 2026
# Code assist: Claude Opus 5.5
#
# Works on Linux, macOS and Windows (Git Bash). Prints markdown lines; paste them into the machine's section.
echo "- date: $(date '+%Y-%m-%d')"
case "$(uname -s)" in
  Linux*)
    echo "- CPU: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | sed 's/^ //'), $(nproc) logical cores"
    echo "- RAM: $(awk '/MemTotal/ {printf "%.1f GB", $2 / 1048576}' /proc/meminfo)"
    echo "- OS: $(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME"), kernel $(uname -r)";;
  Darwin*)
    echo "- CPU: $(sysctl -n machdep.cpu.brand_string), $(sysctl -n hw.ncpu) cores"
    echo "- RAM: $(( $(sysctl -n hw.memsize) / 1073741824 )) GB"
    echo "- OS: macOS $(sw_vers -productVersion)"
    system_profiler SPDisplaysDataType 2>/dev/null | grep -E 'Chipset Model|Total Number of Cores|Metal' | sed 's/^ */- GPU: /';;
  MINGW*|MSYS*|CYGWIN*)
    echo "- CPU: $(powershell -NoProfile -Command '(Get-CimInstance Win32_Processor).Name' | tr -d '\r'), $(nproc) logical cores"
    echo "- RAM: $(powershell -NoProfile -Command '[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)' | tr -d '\r') GB"
    echo "- OS: $(powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | ForEach-Object { \$_.Caption + ' ' + \$_.Version }" | tr -d '\r')";;
esac
command -v nvidia-smi >/dev/null && echo "- GPU: $(nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader)"
command -v nvcc >/dev/null && echo "- CUDA: $(nvcc --version | grep release | sed 's/.*release //')"
command -v icx >/dev/null && echo "- icx: $(icx --version 2>&1 | head -1)"
command -v c++ >/dev/null && echo "- c++: $(c++ --version 2>&1 | head -1)"
command -v python >/dev/null && echo "- Python: $(python --version 2>&1)"
exit 0
