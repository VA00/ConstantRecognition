#!/usr/bin/env wolframscript
(* build_constants_v0.wls - benchmark v0 of published real constants

   Author: Andrzej Odrzywolek
   Date: September 29, 2026 (Wolfram Knowledgebase constants September 30, 2026)
   Code assist: Claude Opus 5.5

   Reads constants_v0_sources.tsv (one row per constant per source: source,
   key, name, Mathematica formula or empty, digits exactly as published or
   empty, note) and writes constants_v0.tsv (one row per constant) plus a
   check report.

   Ground truth rules
   - A formula is trusted only if N[formula, 96] reports Precision >= 80
     (60 s limit): Mathematica silently returns a few correct digits for,
     e.g., products over primes (Artin, Stephens, ...), and those must not
     become truth.
   - Precision is not proof: for numerical sums, products, integrals and
     limits N[] reports Precision 80 or more and is wrong after about 27
     digits (Kepler-Bouwkamp, Lebesgue, Alladi-Grinstead, spiral of Theodorus,
     polygon circumscription, Khinchin-Levy sum, Lueroth, Renyi parking; the
     published digits are right, confirmed with mpmath). So a formula with
     Sum, Product, Integrate or Limit is not trusted, unless it is a row of
     source "fast-converging series, computed"; its value comes from the
     published digits. A formula marked "N-unreliable" in the note is not
     trusted either. check_constants_v0.py recomputes every value with mpmath
     to find further cases.
   - Rows of different sources with the same value (12 significant digits)
     are one constant. Its value is the first trusted formula (sources in the
     order below), otherwise the longest published digits. Written with 64
     significant digits; published-only values keep all their digits, rounded
     to 64 when there are more.
   - Every published digit string must agree with the value within one unit
     of its last digit, or as far as the computed value reaches when a source
     publishes more digits. Every other trusted formula of the constant (a
     second source, an alternate definition) must agree likewise.
   - A note starting with "erratum" marks published digits known to be wrong:
     kept for the record, not checked.

   Usage (from this directory):  wolframscript -file build_constants_v0.wls
*)

dir = DirectoryName[$InputFileName];
src = Import[FileNameJoin[{dir, "constants_v0_sources.tsv"}], "TSV", "Numeric" -> False, CharacterEncoding -> "UTF-8"];
src = Rest[src /. _Missing -> ""];   (* Import turns empty fields into Missing[...]; drop the header *)

(* "1.25e+00", "-0.10491", "262537412640768743.99999999999925007" ->
   {exact value, unit of the last digit, significant digits}; "" -> no digits *)
published[""] := {Missing["none"], Missing["none"], 0};
published[s_String] := Module[{m, sign, int, frac, exp, digits, value},
  m = First@StringCases[StringTrim[s],
      RegularExpression["^(-?)(\\d*)\\.?(\\d*)(?:[eE]([+-]?\\d+))?$"] :> {"$1", "$2", "$3", "$4"}];
  {sign, int, frac, exp} = m;
  exp = If[exp === "", 0, ToExpression[exp]];
  digits = StringDelete[int <> frac, StartOfString ~~ "0" ..];
  value = If[sign === "-", -1, 1] * FromDigits[int <> frac] * 10^(exp - StringLength[frac]);
  {value, 10^(exp - StringLength[frac]), Max[1, StringLength[digits]]}];

(* n significant digits as a plain decimal string *)
fmt[x_, n_] := If[x == 0, "0",
   StringReplace[ToString[NumberForm[N[x, n + 10], n, ExponentFunction -> (Null &), NumberSigns -> {"-", ""}]], " " -> ""]];

(* N[formula, 96] if Mathematica vouches for 80 digits, else {"imprecise", precision} *)
trustedValue[f_String] := Module[{v = Quiet@TimeConstrained[N[ToExpression[f], 96], 60, $Failed]},
   If[NumericQ[v] && Im[v] == 0 && Precision[v] >= 80, Re[v], {"imprecise", If[NumericQ[v], Precision[v], "no value"]}]];

elementaryHeads = {Plus, Times, Power, Sqrt, CubeRoot, Surd, Log, Log10, Exp, Sin, Cos, Tan, Cot, Sec, Csc,
   ArcSin, ArcCos, ArcTan, ArcCot, Sinh, Cosh, Tanh, ArcSinh, ArcCosh, ArcTanh, Pi, E, GoldenRatio, Degree,
   Rational, Integer, List};
(* sums, products, integrals and limits are "special" without evaluating them
   symbolically (some Limit[Sum[...]] would not finish) *)
class[f_String] := If[f === "", "none", Module[{e = ToExpression[f, InputForm, HoldForm]},
    Which[
      StringContainsQ[f, "Sum[" | "Product[" | "Integrate[" | "Limit["], "special",
      TrueQ[Quiet@TimeConstrained[Element[ReleaseHold[e], Rationals], 10, False]], "rational",
      TrueQ[Quiet@TimeConstrained[Element[ReleaseHold[e], Algebraics], 10, False]], "algebraic",
      SubsetQ[elementaryHeads, DeleteCases[Union@Cases[e, s_Symbol :> s, {0, Infinity}, Heads -> True], HoldForm]], "elementary",
      True, "special"]]];

shortSource[s_] := First[StringSplit[s, {" ", ","}]];
erratumQ[r_] := StringStartsQ[r["note"], "erratum"];
unreliableQ[r_] := StringStartsQ[r["note"], "N-unreliable"];

(* ---- values of all formulas, in parallel ---- *)
formulas = DeleteDuplicates[Select[Pick[src[[All, 4]], !StringStartsQ[#, "N-unreliable"] & /@ src[[All, 6]]], # =!= "" &]];
Print["source rows: ", Length[src], "   formulas to evaluate: ", Length[formulas]];
(* cache: formula text -> value, per Mathematica version (N[] of some sums takes up to the 60 s limit) *)
cacheFile = FileNameJoin[{dir, "formula_values_cache.wl"}];
cache = If[FileExistsQ[cacheFile], Get[cacheFile], <||>];
cacheKey = $VersionNumber;
known = Lookup[Lookup[cache, cacheKey, <||>], formulas, Missing["new"]];
todo = Pick[formulas, MissingQ /@ known];
Print["formulas cached: ", Length[formulas] - Length[todo], "   to evaluate: ", Length[todo]];
If[todo =!= {},
  Quiet@LaunchKernels[];
  DistributeDefinitions[trustedValue];
  fresh = AssociationThread[todo -> If[$KernelCount > 0, ParallelMap[trustedValue, todo], Map[trustedValue, todo]]];
  cache[cacheKey] = Join[Lookup[cache, cacheKey, <||>], fresh];
  Put[cache, cacheFile]];
values = Lookup[cache, cacheKey, <||>];

numericalQ[f_String] := StringContainsQ[f, "Sum[" | "Product[" | "Integrate[" | "Limit["];
rows = MapIndexed[Module[{r = #1, p = published[#1[[5]]]},
    <|"idx" -> #2[[1]], "source" -> r[[1]], "key" -> r[[2]], "name" -> r[[3]], "formula" -> r[[4]], "published" -> r[[5]],
      "pvalue" -> p[[1]], "unit" -> p[[2]], "pdigits" -> p[[3]], "note" -> r[[6]],
      "nvalue" -> If[r[[4]] === "" || StringStartsQ[r[[6]], "N-unreliable"], $Failed, values[r[[4]]]],
      "trusted" -> Which[StringStartsQ[r[[6]], "N-unreliable"], {"marked N-unreliable", 0}, r[[4]] === "", $Failed,
         numericalQ[r[[4]]] && !StringStartsQ[r[[1]], "fast-converging"], {"numerical procedure", 0},
         True, values[r[[4]]]]|>] &, src];

(* for grouping only: a numerical N[] value places its row among the
   constants when no 12 published digits do, as if it had 20 digits; it is
   never the value of a constant *)
(* published digits with an erratum note do not place their row *)
pd[r_] := If[StringStartsQ[r["note"], "erratum"], 0, r["pdigits"]];
best[r_] := Which[NumericQ[r["trusted"]], r["trusted"], pd[r] >= 12, r["pvalue"], NumericQ[r["nvalue"]], r["nvalue"],
   pd[r] > 0, r["pvalue"], True, Missing["none"]];
bestDigits[r_] := Which[NumericQ[r["trusted"]], 64, pd[r] >= 12, pd[r], NumericQ[r["nvalue"]], 20, True, pd[r]];
{valueless, rows} = {Select[rows, MissingQ[best[#]] &], Select[rows, !MissingQ[best[#]] &]};
(* Two rows are one constant when both are known to >= 12 digits and agree to
   all the digits both have, at most 20. Not fewer: a 12-digit key merged
   Ramanujan's pi approximation 3.14159265358979301... (16 digits) with pi.
   Not more: a formula that N[] gets wrong after 27 digits must still meet
   the correct published digits, so the check below reports it *)
sameQ[a_, b_] := Module[{d = Min[bestDigits[a], bestDigits[b], 20]},
   d >= 12 && Abs[best[a] - best[b]] <= 10^(1 - d) Abs[best[b]]];
sorted = SortBy[rows, N[best[#], 40] &];
groups = Fold[If[#1 =!= {} && sameQ[Last[Last[#1]], #2], Append[Most[#1], Append[Last[#1], #2]], Append[#1, {#2}]] &, {}, sorted];
(* a group with neither a trusted formula nor published digits has no ground truth *)
{noTruth, groups} = {Select[groups, !AnyTrue[#, NumericQ[#["trusted"]] || (NumericQ[#["pvalue"]] && !erratumQ[#]) &] &],
   Select[groups, AnyTrue[#, NumericQ[#["trusted"]] || (NumericQ[#["pvalue"]] && !erratumQ[#]) &] &]};
Print["constants: ", Length[groups], "   rows without any value: ", Length[valueless],
  "   without ground truth (numerical N[] only): ", StringRiffle[#["key"] & /@ Flatten[noTruth], ", "]];

(* names and the displayed formula come from the first source in this order *)
priority = {"Wikipedia", "Wolfram", "GSL", "Bronstein,", "Boost.Math", "Abramowitz", "OEIS", "fast-converging"};
rank[r_] := FirstPosition[priority, shortSource[r["source"]], {99}][[1]];

out = Table[Module[{g = SortBy[grp, {rank[#], #["idx"]} &], tr, value, digits, formula, checks, fchecks, notes = {}, ref, tol},
    tr = Select[g, NumericQ[#["trusted"]] &];
    If[tr =!= {},
      formula = SelectFirst[g, #["formula"] =!= "" &]["formula"];
      ref = First[tr]["trusted"]; value = fmt[ref, 64]; digits = 64,
      (* no trusted formula: the longest published digits are the value *)
      Module[{longest = First@MaximalBy[Select[g, !erratumQ[#] && #["pdigits"] > 0 &], #["pdigits"] &]},
        formula = SelectFirst[g, #["formula"] =!= "" &, <|"formula" -> ""|>]["formula"]; ref = longest["pvalue"];
        {value, digits} = If[longest["pdigits"] > 64, {fmt[ref, 64], 64}, {longest["published"], longest["pdigits"]}];
        Scan[If[ListQ[#["trusted"]] && NumericQ[#["trusted"][[2]]] && #["trusted"][[2]] > 0,
            AppendTo[notes, "N[" <> #["formula"] <> ", 96] has Precision " <> ToString[Round[#["trusted"][[2]], 0.1]] <> ": value from published digits"]] &, g]]];
    (* a source longer than the computed value can only be checked as far as that value reaches *)
    tol = If[Precision[ref] === Infinity, 0, Abs[ref] 10^(3 - Precision[ref])];
    checks = Select[g, !erratumQ[#] && NumericQ[#["pvalue"]] && Abs[#["pvalue"] - ref] > Max[#["unit"], tol] &];
    fchecks = If[Length[tr] > 1, Select[Rest[tr], Abs[#["trusted"] - ref] > Max[tol, Abs[ref] 10^(3 - Precision[#["trusted"]])] &], {}];
    notes = Join[notes, Select[#["note"] & /@ g, # =!= "" && # =!= "alternate definition" &]];
    <|"name" -> First[g]["name"], "value" -> value, "digits" -> digits, "formula" -> formula,
      "class" -> class[formula],
      "sources" -> StringRiffle[DeleteDuplicates[shortSource[#["source"]] <> If[#["pdigits"] > 0, "(" <> ToString[#["pdigits"]] <> ")", ""] & /@
          Select[g, #["note"] =!= "alternate definition" &]], "; "],
      "check" -> If[checks === {} && fchecks === {}, "ok",
         "MISMATCH " <> StringRiffle[Join[(shortSource[#["source"]] <> " " <> #["key"] <> " digits " <> #["published"] &) /@ checks,
            (shortSource[#["source"]] <> " " <> #["key"] <> " formula " <> #["formula"] &) /@ fchecks], "; "]],
      "notes" -> StringRiffle[DeleteDuplicates[notes], "; "], "sort" -> N[ref, 30], "ndigits" -> digits,
      "numerical" -> ({#["key"], #["nvalue"], ref, digits} & /@ Select[g, ListQ[#["trusted"]] && #["trusted"][[1]] === "numerical procedure" && NumericQ[#["nvalue"]] &])|>], {grp, groups}];
out = SortBy[out, #["sort"] &];

cols = {"id", "name", "value", "digits", "formula", "class", "sources", "check", "notes"};
table = Prepend[MapIndexed[Prepend[Lookup[#1, Rest[cols]], #2[[1]]] &, out], cols];
(* plain TSV: no quotes around text, LF line ends *)
Export[FileNameJoin[{dir, "constants_v0.tsv"}], StringRiffle[Map[ToString, table, {2}], "\n", "\t"] <> "\n", "Text", CharacterEncoding -> "UTF-8"];

Print["classes: ", Tally[Lookup[out, "class"]]];
Print["mismatches (", Count[out, a_ /; a["check"] =!= "ok"], "):"];
Scan[Print["  ", #["name"], " | ", StringTake[#["check"], UpTo[200]], " | value ", StringTake[#["value"], UpTo[30]]] &, Select[out, #["check"] =!= "ok" &]];
(* two constants that agree to all the digits one of them has may be the same constant *)
near = Select[Partition[out, 2, 1], Min[#[[1]]["ndigits"], #[[2]]["ndigits"]] >= 5 && Abs[#[[1]]["sort"] - #[[2]]["sort"]] <= 10^(1 - Min[#[[1]]["ndigits"], #[[2]]["ndigits"]]) Abs[#[[2]]["sort"]] &];
Print["possible duplicates (", Length[near], "):"];
Scan[Print["  ", #[[1]]["name"], " (", #[[1]]["ndigits"], ") ~ ", #[[2]]["name"], " (", #[[2]]["ndigits"], ")   ", StringTake[#[[1]]["value"], UpTo[24]]] &, near];
Print["rows without any value: ", Length[valueless], ": ", StringRiffle[#["key"] & /@ valueless, ", "]];
Print["values with fewer than 64 digits: ", Count[out, a_ /; a["digits"] < 64]];
(* evidence, not a check: numerical N[] values (sums, products, integrals,
   limits) against the value of their constant; every one claims Precision >= 80 *)
evid = {#[[1]], If[#[[2]] == #[[3]], 64., Min[64., -Log10[Abs[#[[2]] - #[[3]]]/Abs[#[[3]]]]]], #[[4]]} & /@ Flatten[Lookup[out, "numerical"], 1];
Print["numerical N[] against the value (", Length[evid], " rows), agreeing digits: ", Sort[Tally[Floor[evid[[All, 2]]]]]];
Scan[Print["  ", #[[1]], ": ", Round[#[[2]], 0.1], " of ", #[[3]]] &, SortBy[Select[evid, #[[2]] < #[[3]] - 1 &], #[[2]] &]];
