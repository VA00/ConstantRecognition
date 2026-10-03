# Algorithms

The subdirectories are independent axes of the recognition problem, not kinds of algorithm.
A concrete algorithm is a point in this grid; for example the C engine is
`targets/constant` x `domain/real` (or `complex`) x `precision_modes/machine_precision` x
`calculators/standard_scientific` x a memoryless CPU enumeration.

| axis | question |
|---|---|
| `targets` | what is recognized (a constant, several constants, a function, a sequence) |
| `domain` | which numbers the arithmetic runs in (real, complex, integers) |
| `precision_modes` | how accurate the input is (symbolic, high precision, machine precision, large errors) |
| `calculators` | which building blocks (the 36 CALC4 buttons, a user list, EML, MeijerG, ...) |
| `methods` | how the space is searched (GPU, tensors, integer relations, ...) |

Code is placed by the axis on which it is new: `calculators/meijerg` is a new search space,
`methods/gpu_cuda` a new way to search the CALC4 space.
