#!/usr/bin/env wolframscript
(* build_constants_v0.wls - benchmark v0 of published real constants

   Author: Andrzej Odrzywolek
   Date: September 29, 2026
   Code assist: Claude Opus 5.5

   Reads constants_v0_sources.tsv (one row per constant per source: source,
   key, name, Mathematica formula or empty, digits exactly as published,
   note; a note starting with "erratum" marks digits known to be wrong, which
   are kept for the record but not checked) and
   writes constants_v0.tsv (one row per constant) plus a check report.

   Ground truth rules
   - A formula is trusted only if N[formula, 96] reports Precision >= 80:
     Mathematica silently returns a few correct digits for, e.g., products
     over primes (Artin, Stephens, ...), and those must not become truth.
     Precision is not proof: for Kepler-Bouwkamp and the Lebesgue constant
     N[] reports Precision 80 and is wrong after 27 and 29 digits. Such a
     formula is marked "N-unreliable" in the note column and not trusted;
     its value comes from a row with a fast-converging series instead (empty
     published digits). check_constants_v0.py recomputes every value with
     mpmath to find such cases.
   - Every published digit string is compared with the trusted value; it
     agrees if it is within one unit of its last digit (rounded or truncated).
   - Rows of different sources with the same value (12 significant digits)
     are one constant. Its value is N[formula, 60] when a trusted formula
     exists, otherwise the longest published string, which all other sources
     of that constant must then agree with.
   - Values are written with 64 significant digits (published digits only:
     all of them, rounded to 64 when there are more).

   Usage (from this directory):  wolframscript -file build_constants_v0.wls
*)

dir = DirectoryName[$InputFileName];
src = Import[FileNameJoin[{dir, "constants_v0_sources.tsv"}], "TSV", "Numeric" -> False, CharacterEncoding -> "UTF-8"];
src = src /. _Missing -> "";   (* Import turns empty fields into Missing[...] *)
header = First[src]; src = Rest[src];

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

trusted[f_String] := If[f === "", $Failed, Module[{v = Quiet@TimeConstrained[N[ToExpression[f], 96], 300, $Failed]},
    If[NumericQ[v] && Im[v] == 0 && Precision[v] >= 80, Re[v], {"imprecise", If[NumericQ[v], Precision[v], "no value"]}]]];

elementaryHeads = {Plus, Times, Power, Sqrt, CubeRoot, Surd, Log, Log10, Exp, Sin, Cos, Tan, Cot, Sec, Csc,
   ArcSin, ArcCos, ArcTan, ArcCot, Sinh, Cosh, Tanh, ArcSinh, ArcCosh, ArcTanh, Pi, E, GoldenRatio, Degree,
   Rational, Integer, List};
class[f_String] := If[f === "", "none", Module[{e = ToExpression[f, InputForm, HoldForm]},
    Which[
      TrueQ[Element[ReleaseHold[e], Rationals]], "rational",
      TrueQ[Quiet@Element[ReleaseHold[e], Algebraics]], "algebraic",
      SubsetQ[elementaryHeads, DeleteCases[Union@Cases[e, s_Symbol :> s, {0, Infinity}, Heads -> True], HoldForm]], "elementary",
      True, "special"]]];

shortSource[s_] := First[StringSplit[s, {" ", ","}]];

rows = Table[Module[{p = published[r[[5]]], t = If[StringStartsQ[r[[6]], "N-unreliable"], {"marked N-unreliable", 0}, trusted[r[[4]]]]},
    <|"source" -> r[[1]], "key" -> r[[2]], "name" -> r[[3]], "formula" -> r[[4]], "published" -> r[[5]],
      "pvalue" -> p[[1]], "unit" -> p[[2]], "pdigits" -> p[[3]], "trusted" -> t,
      "note" -> If[Length[r] >= 6, r[[6]], ""]|>], {r, src}];
erratumQ[r_] := StringStartsQ[r["note"], "erratum"];
Print["source rows: ", Length[rows]];

best[r_] := If[NumericQ[r["trusted"]], r["trusted"], r["pvalue"]];
key[x_] := If[x == 0, 0, Round[N[x, 30] 10^(11 - Floor[Log10[Abs[N[x, 30]]]])] * Sign[x] * 0 + Round[N[x, 30] * 10^(11 - Floor[Log10[Abs[N[x, 30]]]])]];
groups = GatherBy[rows, key[best[#]] &];
Print["constants: ", Length[groups]];

priority = {"Wikipedia", "GSL", "Boost.Math", "Bronstein,", "fast-converging"};
rank[r_] := FirstPosition[priority, shortSource[r["source"]], {99}][[1]];

out = Table[Module[{g = SortBy[grp, rank], tr, value, digits, formula, checks, notes = {}, ref, tol},
    tr = Select[g, NumericQ[#["trusted"]] &];
    If[tr =!= {},
      (* the defining formula of the first source; the value from the first trusted one *)
      formula = SelectFirst[g, #["formula"] =!= "" &]["formula"];
      value = fmt[First[tr]["trusted"], 64]; digits = 64; ref = First[tr]["trusted"],
      (* no trusted formula: the longest published digits are the value *)
      Module[{longest = First@MaximalBy[Select[g, !erratumQ[#] &], #["pdigits"] &]},
        formula = First[g]["formula"]; ref = longest["pvalue"];
        {value, digits} = If[longest["pdigits"] > 64, {fmt[ref, 64], 64}, {longest["published"], longest["pdigits"]}];
        Scan[If[ListQ[#["trusted"]] && NumericQ[#["trusted"][[2]]] && #["trusted"][[2]] > 0,
            AppendTo[notes, "N[" <> #["formula"] <> ", 96] has Precision " <> ToString[Round[#["trusted"][[2]], 0.1]] <> ": value from published digits"]] &, g]]];
    (* a source longer than the computed value can only be checked as far as that value reaches *)
    tol = If[Precision[ref] === Infinity, 0, Abs[ref] 10^(3 - Precision[ref])];
    checks = Select[g, !erratumQ[#] && NumericQ[#["pvalue"]] && Abs[#["pvalue"] - ref] > Max[#["unit"], tol] &];
    notes = Join[notes, Select[#["note"] & /@ g, # =!= "" &]];
    <|"name" -> First[g]["name"], "value" -> value, "digits" -> digits, "formula" -> formula,
      "class" -> class[formula],
      "sources" -> StringRiffle[DeleteDuplicates[shortSource[#["source"]] <> If[#["pdigits"] > 0, "(" <> ToString[#["pdigits"]] <> ")", ""] & /@ g], "; "],
      "check" -> If[checks === {}, "ok", "MISMATCH " <> StringRiffle[(shortSource[#["source"]] <> " " <> #["key"] <> " " <> #["published"] &) /@ checks, "; "]],
      "notes" -> StringRiffle[DeleteDuplicates[notes], "; "], "sort" -> N[ref]|>], {grp, groups}];
out = SortBy[out, #["sort"] &];

cols = {"id", "name", "value", "digits", "formula", "class", "sources", "check", "notes"};
table = Prepend[MapIndexed[Prepend[Lookup[#1, Rest[cols]], #2[[1]]] &, out], cols];
(* plain TSV: no quotes around text, one header line *)
Export[FileNameJoin[{dir, "constants_v0.tsv"}],
  StringRiffle[Map[ToString, table, {2}], "
", "	"] <> "
", "Text", CharacterEncoding -> "UTF-8"];

Print["classes: ", Tally[Lookup[out, "class"]]];
Print["mismatches (", Count[out, a_ /; a["check"] =!= "ok"], "):"];
Scan[Print["  ", #["name"], " | ", #["check"], " | value ", StringTake[#["value"], UpTo[30]]] &, Select[out, #["check"] =!= "ok" &]];
Print["values from published digits only (", Count[out, a_ /; a["digits"] < 64], "):"];
Scan[Print["  ", #["name"], " (", #["digits"], " digits) ", #["notes"]] &, Select[out, #["digits"] < 64 &]];
