#!/bin/bash
# Script convert RPN code and add Mathematica readable formulas at the EOL 
# USAGE: ./RPN_to_Mma_batch.sh search_combined_log.txt



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
