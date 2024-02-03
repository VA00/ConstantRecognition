#!/bin/bash

# Open output file for writing
exec 3> search_combined_log_mma.txt

while IFS= read -r line
do
    # Extract text enclosed by {} and remove commas
    line2=$(echo "$line" | grep -oP '(?<=\{)[^}]*(?=\})' | tr -d ',')
    result=$(js WASM/RPN_to_Mma_interpreter.js $line2)
    
    # Write original line and result to output file with a tab separator
    echo -e "$line\t$result" >&3
done < "$1"

# Close output file
exec 3>&-
