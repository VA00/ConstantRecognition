#!/usr/bin/env wolframscript
(* build_constants_v1.wls - benchmark v1: all OEIS decimal expansions

   Author: Andrzej Odrzywolek
   Date: October 11, 2026
   Code assist: Claude Opus 5.5

   Reads constants_v1_sources.tsv (written by import_oeis_v1.py: one row per OEIS entry, its digits,
   the b-file check, the formula of its Mathematica line) and writes constants_v1.tsv and
   suspicious_v1.tsv (the entries whose check is not "ok").

   Formulas, with the rules of v0 (build_constants_v0.wls):
   - a formula is trusted only if N[formula, 96] reports Precision >= 80 within 60 s;
   - a formula with Sum, Product, Integrate or Limit is not trusted (N[] reports Precision >= 80 and
     can be wrong after about 27 digits); its agreement with the digits is noted only;
   - a trusted formula must agree with the digits within one unit of their last digit. OEIS gives the
     digits of |x|: a formula whose value is minus the digits is negated (noted). A trusted formula
     that disagrees makes the entry suspicious.
   Value: the trusted formula with 64 significant digits when there is one, otherwise OEIS's digits,
   rounded to 64 when there are more.

   Formulas run in parallel, at most 60 s and 2 GB each, saved to formula_values_cache_v1.wl after every
   400 (so an interrupted build continues where it stopped).

   Usage:  wolframscript -file build_constants_v1.wls [kernels, default 6]
*)

dir = DirectoryName[$InputFileName];
data = FileNameJoin[{ParentDirectory[dir], "data", "v1"}];
src = Import[FileNameJoin[{data, "constants_v1_sources.tsv"}], "TSV", "Numeric" -> False, CharacterEncoding -> "UTF-8"];
cols = First[src];
src = AssociationThread[cols -> #] & /@ (Rest[src] /. _Missing -> "");

(* "0.31415e1" -> {exact value, unit of the last digit, significant digits}; "" -> no digits *)
published[""] := {Missing["none"], Missing["none"], 0};
published[s_String] := Module[{m, int, frac, exp, digits},
  m = First@StringCases[StringTrim[s],
      RegularExpression["^(-?)(\\d*)\\.?(\\d*)(?:[eE]([+-]?\\d+))?$"] :> {"$2", "$3", "$4"}];
  {int, frac, exp} = m;
  exp = If[exp === "", 0, ToExpression[exp]];
  digits = StringDelete[int <> frac, StartOfString ~~ "0" ..];
  {FromDigits[int <> frac] * 10^(exp - StringLength[frac]), 10^(exp - StringLength[frac]), StringLength[digits]}];

(* n significant digits as a plain decimal string *)
fmt[x_, n_] := If[x == 0, "0",
   StringReplace[ToString[NumberForm[N[x, n + 10], n, ExponentFunction -> (Null &), NumberSigns -> {"-", ""}]], " " -> ""]];

numericalQ[f_String] := StringContainsQ[f, "Sum[" | "Product[" | "Integrate[" | "Limit["];

elementaryHeads = {Plus, Times, Power, Sqrt, CubeRoot, Surd, Log, Log10, Exp, Sin, Cos, Tan, Cot, Sec, Csc,
   ArcSin, ArcCos, ArcTan, ArcCot, Sinh, Cosh, Tanh, ArcSinh, ArcCosh, ArcTanh, Pi, E, GoldenRatio, Degree,
   Rational, Integer, List};
class[f_String] := If[f === "", "none", Module[{e = ToExpression[f, InputForm, HoldForm]},
    Which[
      numericalQ[f], "special",
      TrueQ[Quiet@TimeConstrained[Element[ReleaseHold[e], Rationals], 10, False]], "rational",
      TrueQ[Quiet@TimeConstrained[Element[ReleaseHold[e], Algebraics], 10, False]], "algebraic",
      SubsetQ[elementaryHeads, DeleteCases[Union@Cases[e, s_Symbol :> s, {0, Infinity}, Heads -> True], HoldForm]], "elementary",
      True, "special"]]];

(* {N[formula, 96] or $Failed, its Precision, class}; at most 60 s and 2 GB per formula *)
evaluate[f_String] := Module[{v = Quiet@MemoryConstrained[TimeConstrained[N[ToExpression[f], 96], 60, $Failed], 2*10^9, $Failed]},
   {If[NumericQ[v], v, $Failed], If[NumericQ[v], Precision[v], 0],
    Quiet@MemoryConstrained[class[f], 2*10^9, "special"]}];

(* ---- all formulas, in parallel, with a cache per Mathematica version ---- *)
formulas = DeleteDuplicates[Select[Lookup[src, "formula"], # =!= "" &]];
cacheFile = FileNameJoin[{dir, "formula_values_cache_v1.wl"}];
cache = If[FileExistsQ[cacheFile], Get[cacheFile], <||>];
known = Lookup[Lookup[cache, $VersionNumber, <||>], formulas, Missing["new"]];
todo = Pick[formulas, MissingQ /@ known];
Print["entries: ", Length[src], "   formulas: ", Length[formulas], "   to evaluate: ", Length[todo]];
(* kernels: the first script argument, default 6 (each may hold up to 2 GB) *)
nKernels = If[Length[$ScriptCommandLine] > 1, ToExpression[$ScriptCommandLine[[2]]], 6];
If[todo =!= {},
  Quiet@LaunchKernels[Min[nKernels, $ProcessorCount]];
  DistributeDefinitions[evaluate, class, numericalQ, elementaryHeads];
  t0 = AbsoluteTime[];
  (* in blocks, the cache saved after each: an interrupted build keeps what it has computed *)
  Do[
    fresh = AssociationThread[block -> If[$KernelCount > 0, ParallelMap[evaluate, block, Method -> "FinestGrained"], Map[evaluate, block]]];
    cache[$VersionNumber] = Join[Lookup[cache, $VersionNumber, <||>], fresh];
    Put[cache, cacheFile];
    Print["  ", Length[cache[$VersionNumber]], " formulas cached, ", Round[AbsoluteTime[] - t0], " s"],
    {block, Partition[todo, UpTo[400]]}];
  Print["evaluated on ", $KernelCount, " kernels in ", Round[AbsoluteTime[] - t0], " s"]];
values = Lookup[cache, $VersionNumber];

agreeDigits[a_, b_] := If[a == b, 64., Min[64., -Log10[Abs[a - b]/Abs[b]]]];

out = Map[Module[{r = #, p = published[#["value"]], f = #["formula"], ev, v, prec, cls, check = {}, notes = {},
      value, digits, formula = #["formula"]},
    If[#["check"] =!= "ok", AppendTo[check, #["check"]]];
    If[#["notes"] =!= "", AppendTo[notes, #["notes"]]];
    {ev, prec, cls} = If[f === "", {$Failed, 0, "none"}, values[f]];
    v = If[NumericQ[ev] && Im[ev] == 0, Re[ev], $Failed];
    Which[
      f === "" || MissingQ[p[[1]]], Null,
      v === $Failed, AppendTo[notes, "formula has no real value (N[] " <> If[NumericQ[ev], "complex", "failed or over 60 s"] <> ")"],
      numericalQ[f], AppendTo[notes, "numerical formula, not trusted: agrees to " <> ToString[Round[agreeDigits[Abs[v], p[[1]]], 0.1]] <> " digits"],
      prec < 80, AppendTo[notes, "N[] Precision " <> ToString[Round[prec, 0.1]] <> ", formula not trusted"],
      Abs[v - p[[1]]] <= p[[2]], Null,
      Abs[-v - p[[1]]] <= p[[2]], (formula = "-(" <> f <> ")"; v = -v; AppendTo[notes, "formula negated (OEIS gives the digits of |x|)"]),
      True, AppendTo[check, "formula differs from the digits: agree to " <> ToString[Round[agreeDigits[v, p[[1]]], 0.1]] <> " digits"]];
    {value, digits} = Which[
      MissingQ[p[[1]]], {"", 0},
      NumericQ[v] && !numericalQ[f] && prec >= 80 && Abs[v - p[[1]]] <= p[[2]], {fmt[v, 64], 64},
      p[[3]] > 64, {fmt[p[[1]], 64], 64},
      True, {fmt[p[[1]], p[[3]]], p[[3]]}];
    <|"id" -> r["key"], "name" -> r["name"], "value" -> value, "digits" -> digits, "formula" -> formula, "class" -> cls,
      "keywords" -> r["keywords"], "sources" -> "OEIS " <> r["source"],
      "check" -> If[check === {}, "ok", StringRiffle[check, "; "]], "notes" -> StringRiffle[notes, "; "], "v0" -> r["v0"]|>] &, src];

ocols = {"id", "name", "value", "digits", "formula", "class", "keywords", "sources", "check", "notes", "v0"};
write[file_, rows_] := Export[FileNameJoin[{data, file}],
   StringRiffle[Map[ToString, Prepend[Lookup[#, ocols] & /@ rows, ocols], {2}], "\n", "\t"] <> "\n", "Text", CharacterEncoding -> "UTF-8"];
write["constants_v1.tsv", out];
sus = Select[out, #["check"] =!= "ok" &];
write["suspicious_v1.tsv", sus];

Print["constants_v1.tsv: ", Length[out], " entries, ", Count[out, a_ /; a["digits"] >= 17], " with >= 17 digits, ",
  Count[out, a_ /; a["digits"] == 64 && a["formula"] =!= "" && !StringContainsQ[a["notes"], "not trusted" | "no real value"]], " with a checked formula"];
Print["classes: ", Tally[Lookup[out, "class"]]];
Print["suspicious: ", Length[sus], "; formula differs: ", Count[sus, a_ /; StringContainsQ[a["check"], "formula differs"]],
  "; b-file: ", Count[sus, a_ /; StringContainsQ[a["check"], "b-file"]], "; near duplicate: ", Count[sus, a_ /; StringContainsQ[a["check"], "near duplicate"]]];
Print["formulas negated: ", Count[out, a_ /; StringContainsQ[a["notes"], "negated"]],
  "   not trusted (Precision < 80): ", Count[out, a_ /; StringContainsQ[a["notes"], "Precision"]],
  "   numerical: ", Count[out, a_ /; StringContainsQ[a["notes"], "numerical formula"]],
  "   no real value: ", Count[out, a_ /; StringContainsQ[a["notes"], "no real value"]]];
Scan[Print["  ", #["id"], " ", StringTake[#["name"], UpTo[50]], ": ", #["check"]] &, Select[sus, StringContainsQ[#["check"], "formula differs"] &]];
