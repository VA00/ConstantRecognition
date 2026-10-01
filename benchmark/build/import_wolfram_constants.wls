#!/usr/bin/env wolframscript
(* import_wolfram_constants.wls - Wolfram Knowledgebase constants into constants_v0_sources.tsv

   Author: Andrzej Odrzywolek
   Date: September 30, 2026
   Code assist: Claude Opus 5.5

   Replaces the rows of source "Wolfram Knowledgebase ..." in
   constants_v0_sources.tsv by the current EntityList["MathematicalConstant"]
   (needs the Wolfram Knowledgebase, i.e. internet access). Other rows are
   kept as they are. Per entity:

   - formula: DefiningFormula, turned active only as text (nothing is
     evaluated here; some are Limit[Sum[...]] that would take forever);
     each AlternateDefinition is one more row (key "<name>/alt<i>") without
     digits, so the build can check the definitions against each other
   - published: NumericalApproximation, with as many significant digits as
     its Precision claims (200 for most, only a few for some constants)
   - skipped: complex values, and entities with neither a value nor a formula

   Usage:  wolframscript -file import_wolfram_constants.wls
*)

dir = DirectoryName[$InputFileName];
file = FileNameJoin[{ParentDirectory[dir], "data", "v0", "constants_v0_sources.tsv"}];
source = "Wolfram Knowledgebase MathematicalConstant (Mathematica " <> First[StringSplit[$Version]] <> ", " <> DateString["ISODate"] <> ")";

(* Inactive[f][args] -> "f[args]" without evaluating anything *)
formulaText[_Missing] := "";
(* ASCII: formal symbols as \[FormalN] rather than invisible private-use characters *)
formulaText[expr_] := StringTake[ToString[Hold @@ {expr} /. Inactive[f_] :> f, InputForm, CharacterEncoding -> "ASCII"], {6, -2}];

(* decimal string with the significant digits the number claims: "1.19814...e+0" *)
decimal[v_?NumberQ] := Module[{d = Floor[Precision[v]], digits, exp},
   {digits, exp} = RealDigits[Abs[v], 10, d];
   If[v < 0, "-", ""] <> ToString[First[digits]] <> "." <> StringJoin[ToString /@ Rest[digits]] <> "e" <> ToString[exp - 1]];
decimal[_] := "";

(* plain text of a typeset name: Superscript[e, -E] -> "e^-e", Subscript[w, 2] -> "w_2" *)
plain[s_String] := s;
plain[Superscript[a_, b_]] := plain[a] <> "^" <> plain[b];
plain[Subscript[a_, b_]] := plain[a] <> "_" <> plain[b];
plain[Row[l_List, ___]] := StringJoin[plain /@ l];
plain[Style[x_, ___]] := plain[x];
plain[x_] := ToString[x, InputForm];
nameText[n_] := StringReplace[plain[n], {"\[ExponentialE]" -> "e", "E" ~~ EndOfString -> "e", "\[ImaginaryI]" -> "i", "\[Hyphen]" -> "-", "\[NonBreakingHyphen]" -> "-"}];

(* one line of text: some names are typeset expressions (e^-e, pi^pi), not strings *)
field[x_String] := StringTrim[StringReplace[x, {"
" -> " ", "	" -> " ", "" -> ""}]];
field[x_] := field[ToString[x, InputForm, CharacterEncoding -> "ASCII"]];

ents = EntityList["MathematicalConstant"];
data = EntityValue[ents, {"Name", "DefiningFormula", "AlternateDefinitions", "NumericalApproximation"}];
rows = {}; skipped = {};
Do[Module[{e = ents[[i]], name, def, alts, approx},
    {name, def, alts, approx} = data[[i]];
    Which[
      MatchQ[approx, _Complex], AppendTo[skipped, CanonicalName[e] <> " (complex)"],
      MissingQ[approx] && MissingQ[def], AppendTo[skipped, CanonicalName[e] <> " (no value, no formula)"],
      True,
        AppendTo[rows, field /@ {source, CanonicalName[e], nameText[name], formulaText[def], decimal[approx], ""}];
        If[ListQ[alts], Do[AppendTo[rows, field /@ {source, CanonicalName[e] <> "/alt" <> ToString[j], nameText[name], formulaText[alts[[j]]], "", "alternate definition"}], {j, Length[alts]}]]]],
  {i, Length[ents]}];

old = Import[file, "TSV", "Numeric" -> False, CharacterEncoding -> "UTF-8"] /. _Missing -> "";
kept = Select[old, !StringStartsQ[First[#], "Wolfram Knowledgebase"] &];
(* notes written by hand on Wolfram rows (errata) survive a re-import, by key *)
oldNotes = Association[Cases[old, {s_String /; StringStartsQ[s, "Wolfram Knowledgebase"], k_, _, _, _, n_String /; n =!= "" && n =!= "alternate definition"} :> (k -> n)]];
rows = rows /. {s_String, k_String, nm_, f_, d_, ""} /; StringStartsQ[s, "Wolfram Knowledgebase"] && KeyExistsQ[oldNotes, k] :> {s, k, nm, f, d, oldNotes[k]};
all = Join[kept, rows];
Export[file, StringRiffle[Map[ToString, all, {2}], "\n", "\t"] <> "\n", "Text", CharacterEncoding -> "UTF-8"];
Print["kept ", Length[kept] - 1, " rows of other sources; added ", Length[rows], " Wolfram rows (",
  Count[rows, r_ /; r[[6]] === ""], " constants, ", Count[rows, r_ /; r[[6]] =!= ""], " alternate definitions)"];
Print["skipped ", Length[skipped], ": ", skipped];
