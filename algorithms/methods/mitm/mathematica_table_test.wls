(* mathematica_table_test.wls - can the meet-in-the-middle search run fast in Wolfram Language? (PHASE3_PLAN.md)

   Author: Andrzej Odrzywolek
   Date: October 4, 2026
   Code assist: Claude Opus 5.5

   Builds the distinct right-side values by size (values only, no formulas) with whole-array operations, times a
   Nearest lookup and three special functions on arrays. Domain rules are simplified (no powers of negative
   numbers, values clipped at 1e150), so the counts are a little below mitm_cr's.
   Run: wolframscript -file mathematica_table_test.wls
   Measured 2026-10-04 (Mathematica 14.2, Ryzen 9 5900X): sizes <= 6 in 0.7 s, 569570 values (mitm_cr: 0.17 s,
   670206); 1e6 Nearest queries 0.17 s; Zeta on 1e5 reals 0.98 s, BesselJ 0.38 s. *)
(* buttons: RIES's common subset: 1-9, pi, e, phi; ln, exp, 1/x, sqrt, x^2; + - * / ^ *)
consts = N[{Pi, E, GoldenRatio, 1, 2, 3, 4, 5, 6, 7, 8, 9}];
big = 1.*^150;
ok[a_] := Pick[a, UnitStep[big - Abs[a]], 1];                      (* finite, moderate *)
unary[a_] := ok @ Join[
   Log[Pick[a, UnitStep[-a], 0]],                                   (* a > 0 *)
   Exp[Pick[a, UnitStep[a - 300.], 0]],                             (* a < 300 *)
   1./Pick[a, Unitize[a], 1],                                       (* a != 0 *)
   Sqrt[Pick[a, UnitStep[a], 1]],                                   (* a >= 0 *)
   ok[a]^2];
binary[a_, b_] := Module[{pa = Pick[a, UnitStep[-a], 0], la, r},
   la = Log[pa];
   r = Join[
     Flatten[Outer[Plus, a, b]], Flatten[Outer[Times, a, b]],
     Flatten[Outer[Subtract, a, b]], Flatten[Outer[Subtract, b, a]],
     Flatten[Outer[Divide, a, Pick[b, Unitize[b], 1]]], Flatten[Outer[Divide, b, Pick[a, Unitize[a], 1]]],
     (* a^b for a > 0 as Exp[b Log a], exponent clipped *)
     Exp[Clip[Flatten[Outer[Times, b, la]], {-300., 300.}]]];
   ok[r]];
Off[General::munfl]; Off[General::ovfl];
vals = <|1 -> DeleteDuplicates[consts]|>;
seen = Union[vals[1]];
Do[
  t = AbsoluteTiming[
    new = unary[vals[k - 1]];
    Do[new = Join[new, binary[vals[i], vals[k - 1 - i]]], {i, 1, Floor[(k - 1)/2]}];
    (* splits i and k-1-i with i > k-1-i are covered by both operand orders in binary *)
    new = Union[new];
    new = Complement[new, seen];
    seen = Union[seen, new];
    vals[k] = new;][[1]];
  Print["size ", k, ": ", Length[vals[k]], " new distinct values, ", Round[t, 0.01], " s, packed: ",
    Developer`PackedArrayQ[vals[k]], ", memory ", Round[MaxMemoryUsed[]/2.^30, 0.01], " GB"],
  {k, 2, 6}];
Print["total distinct <= 6: ", Total[Length /@ Values[vals]]];
(* matching: Nearest on the size-6 values, 1e6 queries *)
nf = AbsoluteTiming[Nearest[vals[6]]];
Print["Nearest function on ", Length[vals[6]], " values: ", Round[nf[[1]], 0.01], " s"];
q = RandomReal[{0.1, 10}, 10^6];
Print["1e6 nearest queries: ", Round[AbsoluteTiming[nf[[2]][q, 1];][[1]], 0.01], " s"];
(* a special function on a whole array *)
s = RandomReal[{1.1, 5}, 10^5];
Print["Zeta on 1e5 machine reals: ", Round[AbsoluteTiming[Zeta[s];][[1]], 0.01], " s; BesselJ[0,.]: ",
  Round[AbsoluteTiming[BesselJ[0, s];][[1]], 0.01], " s; LogGamma: ", Round[AbsoluteTiming[LogGamma[s];][[1]], 0.01], " s"];
