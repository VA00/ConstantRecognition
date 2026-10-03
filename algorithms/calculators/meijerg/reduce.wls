fs = {Exp[-x], Log[1 + x], Sin[x], Cos[x], ArcTan[x], ArcSin[x], ArcSinh[x], ArcTanh[x], Sqrt[1 + x], (1 + x)^a, Sinh[x], Cosh[x],
  Erf[x], Erfc[x], ExpIntegralEi[-x], ExpIntegralE[2, x], Gamma[a, x], Gamma[a]-Gamma[a, x], BesselJ[0, x], BesselJ[1, x], BesselJ[1/3, x], BesselY[0, x],
  BesselI[0, x], BesselK[0, x], BesselK[1/3, x], AiryAi[x], AiryBi[x], StruveH[0, x], SinIntegral[x], CosIntegral[x], FresnelS[x], FresnelC[x],
  EllipticK[x], EllipticE[x], PolyLog[2, -x], PolyLog[3, -x], LegendreP[1/2, x], Hypergeometric2F1[1/3, 2/3, 3/2, x], Hypergeometric1F1[1/2, 3/2, -x],
  BesselJ[0, x]^2, BesselJ[0, Sqrt[x]], Exp[-x^2], Exp[-1/x], x^(1/3) Exp[-x], ArcTan[x]/x, Log[x]/(x - 1), 1/(1 + x^2), LogGamma[x],
  (* not expected to be single G-functions: compositions, sums, infinitely many poles *)
  Tan[x], Sec[x], Exp[Exp[x]], Sin[Sin[x]], x + Sin[x], Exp[x] + x, Gamma[x], Log[Log[x]], Zeta[x]};
(* MeijerGReduce returns Inactive[MeijerG]; printed as G so Mathematica does not simplify it back *)
out = OpenWrite[FileNameJoin[{DirectoryName[$InputFileName], "meijerg_reductions.txt"}]];
WriteString[out, "MeijerGReduce[f, x] in Mathematica " <> $Version <> "; G = MeijerG kept inactive; 5th argument r: argument z^(1/r)

"];
Do[r = Quiet@TimeConstrained[MeijerGReduce[f, x], 20, "timeout"];
  line = ToString[InputForm[f]] <> "  ->  " <> ToString[InputForm[r /. Inactive[MeijerG] -> G]];
  Print[line]; WriteString[out, line <> "
"], {f, fs}];
Close[out];
