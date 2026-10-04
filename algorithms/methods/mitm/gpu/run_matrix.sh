#!/bin/bash
# run_matrix.sh - the Phase 2 benchmark matrix on v0 through benchmark/run/run_mitm_v0.py (results in benchmark/results)
#
# Usage: run_matrix.sh MACHINE BACKEND EXE THREADS [EXTRA_OPTS] [CONFIGS...]
#   MACHINE  e.g. win5080; BACKEND e.g. cpu1, cpu12, cuda, cuda_vhost; EXE the program (mitm_cr or mitm_gpu)
#   CONFIGS  default: all of PHASE2_PLAN.md's matrix: kl4_kr5 kl5_kr6 anyx_kl5_kr6 kl6_kr6 kl5_kr7_tol2
#            common_anyx_kl7_kr7 kl6_kr7_tol2
# Writes v0_mitm_<MACHINE>_<BACKEND>_<config>.tsv and _raw.txt; prints run_mitm_v0.py's summary of each run.
cd "$(dirname "$0")/../../../../benchmark/run" || exit 1
MACHINE=$1; BACKEND=$2; EXE=$3; THREADS=$4; EXTRA=$5; shift 5
CONFIGS=${@:-kl4_kr5 kl5_kr6 anyx_kl5_kr6 kl6_kr6 kl5_kr7_tol2 common_anyx_kl7_kr7 kl6_kr7_tol2}
for cfg in $CONFIGS; do
  case $cfg in
    kl4_kr5) A="--kl 4 --kr 5"; O="";;
    kl5_kr6) A="--kl 5 --kr 6"; O="";;
    anyx_kl5_kr6) A="--kl 5 --kr 6"; O="--anyx";;
    kl6_kr6) A="--kl 6 --kr 6"; O="";;
    kl5_kr7_tol2) A="--kl 5 --kr 7"; O="--tol 2";;
    common_anyx_kl7_kr7) A="--kl 7 --kr 7"; O="--common --anyx";;
    kl6_kr7_tol2) A="--kl 6 --kr 7"; O="--tol 2";;
    *) echo "unknown config $cfg"; continue;;
  esac
  echo "=== $MACHINE $BACKEND $cfg"
  python run_mitm_v0.py --exe "$EXE" $A --threads $THREADS --opts "$O $EXTRA" --tag "${MACHINE}_${BACKEND}_${cfg}" 2>/dev/null | head -12
done
