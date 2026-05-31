# Precision Modes (Input Accuracy)

Algorithms designed to handle specific types of input accuracy.

## Modules
- `symbolic`: Infinitely accurate, exact symbolic inputs.
- `arbitrary_high`: Inputs with very high but finite precision (e.g., 100+ decimal places).
- `machine_precision`: Standard 64-bit float/double inputs with small ULP errors.
- `large_errors`: Inputs with significant uncertainty, requiring robust matching or fuzzy search.
