(* Builds alpha_l5.nb: the 66 RIES equations for alpha within its error bar, solved for x at 40 digits. *)
dir = DirectoryName[$InputFileName];
src = StringReplace[ReadString[FileNameJoin[{dir, "alpha_l5_equations.wl"}]], {"ries = " -> "", "};" -> "}"}];
held = ToExpression[src, InputForm, Hold];               (* Hold[{ {lhs, rhs, root, complexity, text}, ... }] *)
n = Length[held[[1]]];                                   (* held = Hold[list, Null] *)
eqHF[i_] := Replace[Extract[held, {1, i}, Hold], Hold[{l_, r_, __}] :> HoldForm[l == r]];
T = 0.0072973525643`40; sigma = 0.0000000000011`40;     (* CODATA 2022: 7.2973525643(11) x 10^-3 *)

eqs = Table[
   With[{e = eqHF[i], root = held[[1, i, 3]], cplx = held[[1, i, 4]], txt = held[[1, i, 5]]},
    Module[{f, r},
     f = ReleaseHold[e /. Equal -> Subtract];
     r = Quiet@Check[x /. FindRoot[f, {x, T}, WorkingPrecision -> 40, AccuracyGoal -> 38], $Failed];
     <|"n" -> i, "complexity" -> cplx, "equation" -> TraditionalForm[e],
       "x" -> If[NumericQ[r], N[r, 20], "no root"], "(x - T)/sigma" -> If[NumericQ[r], N[(r - T)/sigma, 3], "-"],
       "RIES root" -> root, "RIES postfix" -> txt|>]],
   {i, n}];

grid = Grid[Prepend[Values /@ (KeyDrop[#, "RIES postfix"] & /@ eqs), Keys[KeyDrop[First[eqs], "RIES postfix"]]],
   Frame -> All, Alignment -> Left, Background -> {None, {LightGray}}, ItemStyle -> {Automatic, {"Text"}}];

cmd = "ries -F3 -x -l5 --no-refinement --no-slow-messages -n1000000 --max-match-distance -1.5e-10 0.0072973525643";
explain = "How RIES finds these: it builds left-hand sides that contain x (evaluated at x = T, together with " <>
   "their derivative d/dx) and right-hand sides that are constants only, and matches the two sets; a close pair " <>
   "is solved for x with Newton's method. --max-match-distance -1.5e-10 means: report an equation only if its root " <>
   "x lies within 1.5e-10 * T of the target T (a negative value is relative). It is the distance between the root " <>
   "and the target, not between the values of the two sides. --no-refinement reports every such equation " <>
   "(without it, each new match must be closer than the previous one). The complexity score is RIES's own " <>
   "weighting of the symbols used; many equations are equivalent to each other.";

nb = Notebook[{
   Cell["RIES matches for the fine-structure constant within its error bar", "Title"],
   Cell["Target T = 0.0072973525643, CODATA 2022 uncertainty sigma = 1.1e-12 (relative 1.5e-10). " <>
     "RIES 2026-05-06, level 5, default symbols. " <> ToString[n] <> " equations.", "Text"],
   Cell[cmd, "Program"],
   Cell[explain, "Text"],
   Cell["Equations solved for x with FindRoot at 40 digits; (x - T)/sigma is the distance from the target in " <>
     "units of the CODATA uncertainty (|value| <= 1.36 by construction).", "Text"],
   Cell[BoxData[ToBoxes[grid, StandardForm]], "Output"],
   Cell["Data and code (evaluate to recompute; equations are held so they keep RIES's form)", "Section"],
   Cell[BoxData[MakeBoxes[#, StandardForm] &[Defer[T = 0.0072973525643`40; sigma = 0.0000000000011`40]]], "Input"],
   Cell[BoxData[ToBoxes[Defer[ries = #] &[Table[eqHF[i], {i, n}]], StandardForm]], "Input"],
   Cell[BoxData[ToBoxes[Defer[Table[{i, ries[[i]], x /. FindRoot[ReleaseHold[ries[[i]] /. Equal -> Subtract],
        {x, T}, WorkingPrecision -> 40]}, {i, Length[ries]}] // Grid], StandardForm]], "Input"]
   }, WindowTitle -> "RIES alpha level 5"];
Export[FileNameJoin[{dir, "alpha_l5.nb"}], nb];
Print[n, " equations; roots found: ", Count[eqs, _?(NumericQ[#["x"]] &)],
  "; max |x - T|/sigma = ", Max[Abs[Select[eqs[[All, "(x - T)/sigma"]], NumericQ]]]];
Print[Take[eqs[[All, {"n", "equation", "x", "(x - T)/sigma"}]], 3]];
