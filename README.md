C code for recognition/identification/search of mathematical formulas, equivalent to numerical, e.g.,  137.035999206. 

Brute-force search is performed in parallel using specified number of threads. 
RPN scientific calculator with 36 standard buttons is used to define space of possible formulas. 
Codes are encoded as subsequent base-36 numbers, where digits are associated with calculator butons. 

WASM version can be tested online https://th.if.uj.edu.pl/~odrzywolek/WASM/



## Project Vision

Constant Recognition provides a flexible, versatile, and easy-to-use application for identifying numerical results as closed-form mathematical expressions.

**Target users:**
- Researchers and engineers with high-precision results from arbitrary-precision numerical calculations
- Experimentalists with measurements known only to limited accuracy with error bars
- Students and educators exploring mathematical relationships
- Recreational mathematicians

**Architecture:**
- **Web frontend** for everyday/occasional use (runs in browser, nearly as fast as native) - but it is not a toy, tested on days-long runs with several CPUs!
- **WASM engine** for CPU-parallel search
- **WebGPU engine** for GPU-accelerated search  
- **Native C library** for console applications and integration into other software
- **Operating systems:** Linux, macOS, and Windows

---

## Design Rationale

The engine is a **memoryless exhaustive search**. This is a deliberate choice; every change to the C core must preserve it.

**Enumerate, do not remember.** A search over codes of length K keeps O(K) state: the current ternary form, the current button indices and one evaluation stack of K values. There are no tables of previously computed values, no hashing, no memoization, no frontier sets. Memory use is independent of the search depth and of the button set, so the reachable depth is limited by time only, never by RAM.

**Why.** Solvers that store intermediate results (meet-in-the-middle, dynamic programming over token counts, RIES-style trees, the Rust/Python EML solvers in `cuda/eml_competition`) are fast at moderate depth, but their memory grows exponentially with depth and they need shared state, which is awkward across GPU threads, WASM workers or cluster nodes. A memoryless search has a trivial parallel contract: the space of codes of length K is the index range [0, 3^K) over ternary forms, and any contiguous chunk `(cpu_id, ncpus)` can be computed by any thread on any device with no communication. This is what lets the same algorithm run in browser workers, on CUDA GPUs and in native batch jobs, and run for days without growing.

**Shortest first, exhaustive.** Codes are generated in order of increasing length, and all codes of one length are evaluated before the next length starts. The first exact match is therefore the shortest formula in the chosen button set, and a completed level without a match is a proof that no formula of that length exists (up to floating-point tolerance). Heuristic engines can make neither claim.

**Two-stage generation.** A code is a ternary form (which slots hold constants, unary functions and binary operators) combined with a button assignment for every slot. Only the forms that never underflow the stack and leave exactly one value are grammatical; their number is the Motzkin number M(K−1), e.g. 51 of the 3^7 = 2187 strings at K=7. Every grammatical form is a valid RPN program by construction. The engine loops over the forms and, for each, over the Cartesian product of button choices; the assignment stage is where the formula count explodes (about 2.3·10^9 formulas at K=7 for the 36-button CALC4).

**Cost of the choice.** Without memoization, identical subexpressions are recomputed. Part of that is recovered by evaluating incrementally along the recursion (the stack after slot i is reused for every completion of slots i+1..K), which still needs only the single O(K) stack. Table-based caching of elementary functions appears in the roadmap as an idea, but it would trade the memory guarantee for speed and is not the default.

**Floating-point semantics.** Values are IEEE doubles (or complex doubles). NaN and infinities propagate through intermediate results exactly as the hardware produces them, so `exp(log 0) = 0` and `atan(1/0) = π/2` are legitimate codes; only a formula whose final value is non-finite is discarded. The identification criteria (relative error, compression ratio, accuracy jump) are applied to final values only.

---

## Use Cases

### 1. Real Number Identification
Given a mysterious number like `0.51404189589007076139762973957688` from numerical calculations, find a simple analytical formula. Expected: `5π²/96` (may be returned as equivalent forms like `5·arctan(-1)²/6`).

### 2. Formula Simplification
Transform a known but unwieldy formula into a simpler equivalent form. Useful e.g. when expressions don't fit in single-column scientific publications.

### 3. Primitive Computer Algebra
Numerically evaluate sums, products, and integrals, then recognize the result as a known closed form. Covers much of standard STEM calculus curriculum.

### 4. Operation Discovery
Discover if one mathematical operation can be expressed in terms of others. Example: Can addition be expressed using only exponentiation and logarithms? Search for Glaisher + Catalan using only those operations.

### 5. Recreational Mathematics
Generate interesting numerical coincidences. Example: `2026 = 1 + (9×5)²`. Generate π-day puzzles, etc.

### 6. Physical Constants Analysis
When new measurements of fundamental constants (e.g., fine-structure constant) are published, search for potential mathematical relationships.

### 7. Exam Problem Generation
Create genuinely new problems with elegant solutions. Example: `11/13 = tanh(ln(√12))` — a non-obvious identity for students to discover.

---

## Current Status

### Implemented
- Input box with target constant and optional error specification
- Complex-domain search (`1+2i` targets, imaginary unit `i` as a button, `log(-1) = iπ`) via a dedicated complex WASM engine
- Buttons beyond CALC4: constant 0 and the arbitrary-base logarithm `Log[b, x]` (on by default); imaginary unit i, sign change `Minus[x]`, Glaisher, Catalan, Khinchin, EulerGamma (off by default); Γ and φ are off by default too
- Direct enumeration of grammatical ternary forms (`C/rpn_forms.h`) and incremental stack evaluation in both engines: same candidates in the same order, about 4× faster (real engine 19 → 79 M formulas/s in WASM, 32 → 135 M/s native arm64)
- Parallel CPU search via Web Workers + WASM
- GPU search via WebGPU compute shaders
- Sortable results table with filters
- Compression ratio, relative error, and probability as identification criteria
- Relative error and progress tracking
- Timer for performance benchmarks
- Hamming distance metric

### In Progress
- Modular calculator architecture (`vsearch_RPN_core` refactoring)
- Cross-platform native builds (Windows, Linux, macOS)
- Multiple calculators (Subsets of CALC4 with 36 buttons)

---

## Frontend Roadmap

### High Priority
| Feature | Description | Complexity | Frontend Visibility | Backend availability
|---------|-------------|------------|---------------------|---------------------
| Calculator Creator UI | Drag-and-drop interface for defining custom instruction sets | High | Advanced options | Yes, via master CALC4 and string arg passing
| Preset Calculator Selection | Choose from: CALC4, RIES-compatible, TI-35, CASIO, etc. | Medium | Dropdown list, CALC4 default | Yes, via calc/*.h
| Complex Number Support | Search using complex constants and operations | Medium | Domain switch (Auto/Real/Complex), autoselected for complex targets or when `i` is enabled | Yes, `C/vsearch_RPN_complex.c` + `CALC4C.h`, exported as `search_RPN_complex`

### Medium Priority
| Feature | Description | Complexity | Frontend Visibility | Backend availability
|---------|-------------|------------|---------------------|---------------------
| Multiple Identification Criteria | Select any combination of accuracy drop, probability, compression ratio | Low | Advanced options | Partially implemented
| External Backend Integration | Connect to RIES, SymPy/nsimplify as alternative engines | Medium | Advanced options | Not implemented
| Multiple Norm Selection | Relative error, absolute error, ULP distance, Hamming distance, string dissimilarity, integer/rational/RPN relationships | Low | Advanced options | Partial implementation
| Sorting Toggle | Choose `<` vs `≤` for discrete metrics | Low | Advanced options | Yes, via CompareMode in vsearch_core()
| Sorting Direction Toggle | Choose from `alternating` (default)  vs `from above`/`from below` for continuous discrete metrics | Low | Advanced options | No

### Lower Priority / Exploratory
| Feature | Description | Complexity | Frontend Visibility | Backend availability
|---------|-------------|------------|---------------------|---------------------
| Integer Target Mode | Dedicated search using Prime, Fibonacci, Binomial, etc. | Medium | Advanced options or autoselect if target is an integer | No
| Multi-Constant Search | Find formulas involving multiple target constants (any/all) | High | File open dialog | No
| Univariate Function Search | Identify functions, not just constants | Very High | File open dialog | Yes
| Integer Sequence Search | Identify sequences using GPU integer arithmetic| High | Advanced options, File open dialog or autoselect if integer sequence is pasted/typed | No
| Calculator Completeness Checker | Verify a calculator can express all "expected" results | Medium | Part of calculator creator | No, only Wolfram code
| Cross-Calculator Complexity Comparison | Compare expression complexity across different instruction sets using e.g. EmL compiler | Low | Intermediate results table | No

---

## Backend / Algorithm Roadmap

### Performance Optimizations
| Feature | Description | Potential Speedup |
|---------|-------------|-------------------|
| Memoized Elementary Functions | Cache repeated subexpression evaluations | ? |
| Improved Load Balancing | Better work distribution across parallel workers | 2-10 |
| Ternary Operator Support | Use FMA and similar compound operations | ? |
| Optimal instruction set | Find Goldilocks set of redundant consts, funcs and ops | 2
| Difficult integers | Numbers which are unreachable by any short RPN sequence, but offspring many others | ?

### Extended Capabilities
| Feature | Description | Complexity |
|---------|-------------|------------|
| Bidirectional Search | For high-precision constants, search from both ends | High |
| Digit Concatenation | Allow building numbers like 137 from 1, 3, 7 | Medium |
| Simple Special Functions | LambertW, Zeta — fixed arity, just add C code | Low |
| Parametric Special Functions | Hypergeometric, MeijerG — variable-length argument lists, requires core redesign | Very High |
| Numerical Sum/Integral Buttons | `INF_SUM` unary acting as `Sum f(n), n=1..∞` | High |
| Complex Tetration | True 2-argument real and complex tetration — no standard implementation exists | Very High |
| Search History Tracking | Store and learn from user feedback | Medium |

---

## Benchmark Suite

To validate correctness and measure performance, we need systematic benchmarks:

### Synthetic Benchmarks
| Category | Description | Source |
|----------|-------------|--------|
| Simple Calculator | CASIO HL-815L expressible numbers (RPN & tree) | Generate |
| Integers | Small integers, primes, factorials | Generate |
| Rationals | Simple fractions like 11/13, 22/7 | Generate |
| EL Numbers | Numbers expressible by CALC4 instruction set | Generate |
| Decimal Patterns | Numbers like 0.123, 0.111, 0.142857... | Generate |
| Algebraic Numbers | Roots of low-degree polynomials | Generate |
| Random EL Numbers | Random valid RPN expressions | Generate |

### Reference Databases
| Category | Description | Source |
|----------|-------------|--------|
| Wikipedia 100 | [List of mathematical constants](https://en.wikipedia.org/wiki/List_of_mathematical_constants) | External |
| Physics Constants | Dimensionless fundamental constants (α, μ, etc.) | CODATA |
| OEIS Constants | Constants from integer sequence definitions | OEIS |
| ISC Database | Historical Inverse Symbolic Calculator data | Archive |

---

## Related Software

Understanding existing tools helps position our project:

| Software | Approach | Status | Notes |
|----------|----------|--------|-------|
| **RIES** | Recursive tree, bidirectional, non-exhaustive | Active | Fast, memory-hungry, single-threaded |
| **SymPy nsimplify** | Heuristic methods | Active | Python, fast |
| **Wolfram Alpha** | Proprietary, likely heuristic + database | Active | Web only, not in Mathematica directly |
| **Maple identify** | Fixed expression templates, non-exhaustive | Active | Proprietary |
| **AskConstants** | Mathematica package | Unknown | Limited documentation |
| **MeSearch** | Java, bidirectional, well-documented | Defunct? | Code unavailable |
| **ISC/Plouffe Inverter** | Searchable database | Defunct | Historical reference |

**Our differentiators:**
- Open source with modern web frontend
- Parallel CPU workers via WASM 
- GPU acceleration via WebGPU
- Exhaustive brute-force search (guaranteed to find simplest expression)
- Configurable instruction sets [TODO]
- No database/backend hosting costs (runs entirely client-side)
- Complex numbers

---

## Glossary

| Term | Definition |
|------|------------|
| **EL number** | Exp-Log number expressible using elementary functions (exp, log, trig, arithmetic) |
| **ULP** | Unit in Last Place — discrete measure of floating-point distance |
| **RPN** | Reverse Polish Notation — stack-based expression format |
| **Compression Ratio** | Information content of target number / information content of formula |
| **Motzkin number** | Count of valid RPN ternary structures for length K |
| **CALC4** | Our standard 36-button calculator (13 const + 18 unary + 5 binary) |
| **EmL** | Theoretical minimal calculator with single operation |


