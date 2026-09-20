# EML reduction game — plan and hand-over notes

Game page for the Małopolska Noc Naukowców talk: the Next.js route `/game/`.

**Status (2026-09-20):** prototype implemented and deployed under the
calculator (`.../calculator/game/`). Start set = `CALC_Milei.png` (38 buttons),
easy mode only (1, Exp, Log, − locked), exact one-point match, no second-witness
verification, game clock from the first attempt to the win. Files: `page.tsx`,
`lib/game.ts` (rules), `lib/depth.ts` (search depth for a time budget),
`lib/searchPool.ts` (worker pool), `components/Keypad.tsx`, `RemovalLog.tsx`,
`ResultOverlay.tsx` (phone pop-up); tests in `../../tests/game.test.ts`.
Local dev needs a base path, e.g. `NEXT_PUBLIC_BASE_PATH=/cr npm run dev` and
`http://localhost:3000/cr/game/`; plain `npm run dev` serves nested routes
without working scripts (relative `assetPrefix`).

The rest of this file is the original plan and the agreed rules.

## The game

Start with a scientific calculator and remove buttons one at a time. A button
may be removed only when the recognizer proves it redundant by finding an
exact formula for it with the *remaining* buttons:

- **Constant** (e.g. `9`): search for its value. `9 = 3²` removes the `9` key.
- **Unary function** (e.g. `√x`): search for `f(W)` where `W` is a *witness*
  constant that is not otherwise in the calculator (Catalan `G`). The witness
  is added as a temporary button for that search only. Finding
  `√G = G^(1/2)` removes `√x`.
- **Binary operator** (e.g. `+`): search for `W1 + W2` with two witnesses.
- **Goal:** the four EML primitives `1, exp, log, −` (EML[x,y] = Exp[x] − Log[y]).
- **Gameplay is the order of removals.** Remove `log`, `exp` or `i` too early
  and the remaining formulas become too long to find.

Decisions taken (2026-09-19):

- **Γ is excluded from the game** (not an elementary function, `Γ(W)` can never
  be expressed by the others). It stays in the recognizer.
- **Easy mode:** the four goal buttons are locked. **Hard mode:** anything can
  be removed (the trap of removing `exp` early is then real).
- **Witnesses:** Catalan `G` as primary, EulerGamma `γ` to re-verify the found
  identity independently; Glaisher `A` and Khinchin `K₀` as the second pair
  for binary operators. All four are in both engines (`CATALAN`, `EULERGAMMA`,
  `GLAISHER`, `KHINCHIN`).
- **Verification:** a found formula is accepted only if it also holds when the
  witness is replaced by the second witness (evaluate the RPN with
  `evaluate_RPN_complex`, compare to `f(W2)`). This kills numerical
  coincidences. It does not apply to constants.
- **Non-finite values, option A:** `NaN`/`∞` propagate; only a non-finite final
  value is rejected (same as the real engine). Consequences: `exp(log 0) = 0`
  and `π/2 = atan(1/0)` are legal, and so are floating-point saturations such
  as `tanh(e⁵) = 1` or `atan(e^(e^(e^5)))) = π/2`. In hard mode `1` could be
  "removed" this way; decide whether a game rule should forbid it.
- **Open:** UI language (Polish / English / toggle), date of the talk, exact
  starting button set (palette standard set + `i` + `±`? with or without `0`
  and `log_y x`?), what "stuck" looks like (undo is planned).

## What is already in place (all on `main`)

Engine (`C/`):

- `vsearch_RPN_complex.c` + `CALC4C.h`: complex-domain search, same JSON as the
  real engine plus `value_re`/`value_im` per row and `"domain":"COMPLEX"`.
  Buttons: CALC4 + `ZERO`, `I`, `GLAISHER`, `CATALAN`, `KHINCHIN`,
  `EULERGAMMA`, `MINUS` (−x), `LOGARITHM` (log_b, base pushed last).
- `rpn_forms.h`: direct enumeration of grammatical ternary forms, shared by
  both engines. Both engines evaluate incrementally along the recursion.
  Real engine ~80 M formulas/s per WASM thread, complex ~32 M/s.
- WASM exports (`make wasm` in `C/` writes `public/wasm/vsearch.{js,wasm}`;
  commit both): `search_RPN_with_cr`, `search_RPN_custom_cr`,
  `search_RPN_complex(z_re, z_im, dz, minK, maxK, cpuId, ncpus, consts, funcs,
  ops, crThreshold)`, `evaluate_RPN_complex(rpn)` →
  `{"ok":1,"finite":1,"re":…,"im":…}`.
- Binary convention everywhere: RPN `a, b, OP` means `OP(b, a)`, i.e.
  `ONE, TWO, SUBTRACT` = 2 − 1 and `EIGHT, TWO, LOGARITHM` = log₂ 8.

Frontend (`calculator_frontend/`):

- `public/wasm/worker.js` accepts search tasks with `domain: 'complex'`
  (button lists must be explicit) and `{type: 'evaluate', id, rpn}` messages
  answered with `{type: 'evaluated', id, rpn, ok, finite, re, im}`.
- `app/calculator/lib/taskQueue.ts`: `buildTaskQueue(depth, selection)` works
  for any button subset, switches to contiguous index ranges for deep levels
  of small calculators; `estimateWork(depth, selection)` and
  `levelWork(K, nc, nu, nb)` give exact formula counts.
- `app/calculator/lib/estimate.ts`: time estimate from measured per-thread
  throughput (`localStorage`).
- `app/calculator/lib/rpn.ts`: `rpnToLatex`, `rpnToMathematica`, `evaluateRPN`
  know every button above; `lib/complex.ts` parses/format complex numbers.
- `app/calculator/lib/calculators.ts`: palette definition (core constants
  π e −1 0 i, digits, operators `+ − × ÷ x^y log_y x`, extras Γ ±, extra
  constants φ A G K₀ γ, `defaultDisabled: ['I']`).

## Feasibility facts (measured)

- Full 36-button palette: K=7 ≈ 2·10⁹ formulas, K=8 ≈ 7·10¹⁰ (47 s on a
  14-thread M3 Max for K≤8).
- The 4-button EML endgame grows like Catalan numbers: K=16 ≈ 3.5·10⁷
  formulas. `i` from `{1, exp, log, −}` was found at K=16 in 0.4 s single
  thread: `exp(exp(log(log(−1)) − log 2))`. `2 = 1 − ((1−1) − 1)` is K=7.
- Removal order matters: `i` needs `√` or `/2` around (`√−1`, K=2) or K=16
  without; `π` needs `i` (`log(−1)/i`, K=4) or trig; `√x` needs `^` or `/`
  (`x^(1/2)`, K=4) or K≈14 with only `2`.

## Suggested implementation steps

1. `app/game/page.tsx` with a 6×6 keypad built from the same
   `CalculatorPalette` styling; clicking a key starts a removal attempt.
2. `app/game/lib/game.ts`: pure state machine — remaining buttons, history of
   removals `{button, rpn, latex}`, undo, mode (easy/hard), start set,
   `removalTask(button)` → `{targetRe, targetIm, selection, witnesses}`.
   For functions/operators substitute the witness tokens by `x`/`y` in the
   LaTeX of the found identity.
3. A `useSearch` hook that reuses the worker pool logic of
   `app/calculator/page.tsx` (task queue, early exit on SUCCESS) but always
   with `domain: 'complex'` and exact tolerance (`inputPrecision: 0`).
   Compute the witness target with an `evaluate` message rather than in JS,
   so target and search share one implementation.
4. Adaptive depth: raise `maxK` while `estimateWork` stays under a budget
   derived from the measured throughput (e.g. 30 s); offer "search deeper".
5. Verification step with the second witness; reject and explain on failure.
6. Win screen at `{ONE, EXP, LOG, SUBTRACT}`; "stuck" hint listing removable
   buttons found by a background probe (optional).
7. Unit-test `game.ts` (order constraints, undo, easy/hard locks).

## Commands

```
cd C && make wasm && gcc -O2 -Wall test/test_vsearch_complex.c vsearch_RPN_complex.c -lm -o /tmp/tc && /tmp/tc
cd calculator_frontend && npm test && npm run dev      # http://localhost:3000/calculator/
```

Pitfalls: `rpn.ts` and `EmptyState.tsx` use CRLF line endings, keep them;
`isFullCalculator()` is false for the default palette (Γ off, log_y on), so
searches use `search_RPN_custom_cr`; complex functions of real arguments take
the real libm path, and complex Γ is Lanczos (≈20 ULP median, worse for
|z| > 10).
