#include <math.h>
#include <string.h>
#include <complex.h>
#include <stdio.h>
#include "math2.h"
#define STACKSIZE 16
#define MAXTHREADS 128
#define True 1
#define False 0
#define INSTR_NUM 36

/*
Unary functions:
                               1                                             2
{{LOG, Log}, {EXP, Exp}, {INV, -- & }, {MINUS, Minus}, {SQRT, Sqrt}, {SQR, #1  & }, {SIN, Sin}, {ARCSIN, ArcSin}, {COS, Cos}, {ARCCOS, ArcCos}, {TAN, Tan}, {ARCTAN, ArcTan}, {SINH, Sinh}, {ARCSINH, ArcSinh}, {COSH, Cosh}, {ARCCOSH, ArcCosh}, {TANH, Tanh}, {ARCTANH, ArcTanh}}
                               #1
Push on stack:
{{PI, Pi}, {EULER, E}, {NEG, -1}, {ONE, 1}, {TWO, 2}, {THREE, 3}, {FOUR, 4}, {FIVE, 5}, {SIX, 6}, {SEVEN, 7}, {EIGHT, 8}, {NINE, 9}, {GOLDENRATIO, GoldenRatio}}
Binary operators:
{{PLUS, Plus}, {TIMES, Times}, {SUBTRACT, Subtract}, {DIVIDE, Divide}, {POWER, Power}}

{0 -> PI, 1 -> EULER, 2 -> NEG, 3 -> LOG, 4 -> EXP, 5 -> PLUS, 6 -> TIMES, 7 -> INV, 8 -> MINUS, 9 -> SQRT, a -> SQR, b -> SIN, c -> ARCSIN, d -> COS, e -> ARCCOS, f -> TAN, g -> ARCTAN, h -> SINH, i -> ARCSINH, j -> COSH, k -> ARCCOSH, l -> TANH, m -> ARCTANH, n -> ONE, o -> TWO, p -> THREE, q -> FOUR, r -> FIVE, s -> SIX, t -> SEVEN, u -> EIGHT, v -> NINE, w -> GOLDENRATIO, x -> SUBTRACT, y -> DIVIDE, z -> POWER}

*/
float constantf(const char * , const int);
double constant(const char * , const int);
long double constantl(const char * , const int);
float complex cconstantf(const char * , const int);
double complex cconstant(const char * , const int);
long double complex cconstantl(const char * , const int);

int checkSyntax(const char * , const int);
