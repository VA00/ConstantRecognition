#!/bin/bash

NCPUS=$(nproc --all)
START_TIME=$(date +%s)
echo "Search started at $(date '+%Y-%m-%d %H:%M') using $NCPUS CPUs."
echo "0" > found.txt

for i in $(seq 1 $NCPUS)
do
   ../C/constantRecognition $i $NCPUS &
done

wait

END_TIME=$(date +%s)
ELAPSED_TIME=$((END_TIME - START_TIME))

# Reading the content of found.txt
FOUND=$(cat found.txt)

if [ "$FOUND" -eq 1 ]; then
    RESULT_MESSAGE="Search succeeded."
else
    RESULT_MESSAGE="Search did not succeed."
fi

echo "Search finished at $(date '+%Y-%m-%d %H:%M')."
echo "Total elapsed time: $ELAPSED_TIME seconds."
echo "$RESULT_MESSAGE"
exit 0