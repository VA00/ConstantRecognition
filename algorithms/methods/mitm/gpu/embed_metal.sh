#!/bin/sh
# embed_metal.sh - Metal Shading Language sources as one C++ string, for kernels compiled at run time
#
# Author: Andrzej Odrzywolek
# Date: October 4, 2026
# Code assist: Claude Opus 5.5
#
# Usage: embed_metal.sh NAME file1 file2 ... > out.h
# Writes "static const char NAME[] = R"MTLSRC(...)MTLSRC";" with the files concatenated in order. Local includes
# (#include "...") are dropped: the files they name must be given earlier on the command line. So the full Xcode
# (the offline compiler xcrun metal) is not needed, and the binary does not depend on files next to it.
name=$1
shift
printf 'static const char %s[] = R"MTLSRC(' "$name"
for f in "$@"; do
  printf '\n// ---- %s\n' "$(basename "$f")"
  sed '/^#include "/d' "$f"
done
printf ')MTLSRC";\n'
