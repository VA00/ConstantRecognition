#!/bin/bash

NCPUS=$(nproc --all)
#NCPUS=1
START_TIME=$(date +%s)
echo "Search started at $(date '+%Y-%m-%d %H:%M') using $NCPUS CPUs."
echo "0" > found.txt

for i in $(seq 1 $NCPUS)
do
   ./C/ComplexConstantRecognition 0.54111559793651082889293569336129+0.0I $i $NCPUS &
done

wait

END_TIME=$(date +%s)
ELAPSED_TIME=$((END_TIME - START_TIME))

# Reading the content of found.txt
FOUND=$(cat found.txt)

if [ "$FOUND" -eq 1 ]; then
    RESULT_MESSAGE="Search succeeded."
else
    RESULT_MESSAGE="Search did not succeed. Check log files."
fi



# Define the output file
output_file="search_combined_log.txt"
> "$output_file"

# Counter to keep track of the first file
first_file=1

# Loop through each log file and append its contents to the output file
for log_file in search_log_*.txt; do
    echo "Appending $log_file to $output_file"

    # Check if it's the first file
    if [ $first_file -eq 1 ]; then
        cat "$log_file" >> "$output_file"
        first_file=0
    else
        # Skip the first line (header) for subsequent files
        tail -n +2 "$log_file" >> "$output_file"
    fi
done

sort -n "$output_file" -o "$output_file"

echo "Log files combined into sorted $output_file"



echo "Search finished at $(date '+%Y-%m-%d %H:%M')."
echo "Total elapsed time: $ELAPSED_TIME seconds."
echo "$RESULT_MESSAGE"
exit 0
