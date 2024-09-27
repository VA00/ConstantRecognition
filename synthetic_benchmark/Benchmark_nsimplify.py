import csv
import time
from sympy import nsimplify, sympify
from sympy.printing.mathematica import mathematica_code

# Input and output file names

name = 'Benchmark_CASIO_HL-815L_K6_L2'
input_file = name+'.dat'
output_file = name+'_results.dat'

# Read the CSV data
with open(input_file, newline='') as csvfile:
    reader = csv.DictReader(csvfile)
    data = list(reader)

# Start the timer
start_time = time.time()

# Process each row
for row in data:
    try:
        # Convert the Float128 column to a float
        float_value = sympify(row['Float128'].replace(' I', 'j'))
        # Apply nsimplify
        simplified = nsimplify(float_value)
        # Store the result in a new column
        row['nsimplify'] = str(simplified)
        # Convert the simplified expression to Mathematica code
        mathematica_expr = mathematica_code(simplified)
        row['nsimplifyMma'] = mathematica_expr
    except Exception as e:
        row['nsimplify'] = f"Error: {e}"
        row['nsimplify_mathematica'] = f"Error: {e}"

# End the timer
end_time = time.time()
total_time = end_time - start_time

print(f"Total time for nsimplify(): {total_time:.6f} seconds")

# Write the results to a new CSV file
with open(output_file, 'w', newline='') as csvfile:
    fieldnames = reader.fieldnames + ['nsimplify', 'nsimplifyMma']
    writer = csv.DictWriter(csvfile, fieldnames=fieldnames)

    writer.writeheader()
    for row in data:
        writer.writerow(row)

print(f"Results written to {output_file}")
