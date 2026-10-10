// df64_apply.h - the functions of test_df64.cpp by number, shared by the CPU, CUDA and Metal runs of the test
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5

#ifndef DF64_APPLY_H
#define DF64_APPLY_H
#include "df64.h"

enum { F_ADD, F_SUB, F_MUL, F_DIV, F_SQRT, F_EXP, F_LOG, F_SIN, F_COS, F_TAN, F_ASIN, F_ACOS, F_ATAN, F_SINH, F_COSH,
       F_TANH, F_ASINH, F_ACOSH, F_ATANH, F_POW, F_GAMMA, F_DIGAMMA, F_COUNT };

DF_FN df64 df_apply(int f, df64 a, df64 b)
{
    switch (f) {
    case F_ADD: return df_add(a, b);
    case F_SUB: return df_sub(a, b);
    case F_MUL: return df_mul(a, b);
    case F_DIV: return df_div(a, b);
    case F_SQRT: return df_sqrt(a);
    case F_EXP: return df_exp(a);
    case F_LOG: return df_log(a);
    case F_SIN: return df_sin(a);
    case F_COS: return df_cos(a);
    case F_TAN: return df_tan(a);
    case F_ASIN: return df_asin(a);
    case F_ACOS: return df_acos(a);
    case F_ATAN: return df_atan(a);
    case F_SINH: return df_sinh(a);
    case F_COSH: return df_cosh(a);
    case F_TANH: return df_tanh(a);
    case F_ASINH: return df_asinh(a);
    case F_ACOSH: return df_acosh(a);
    case F_ATANH: return df_atanh(a);
    case F_POW: return df_pow(a, b);
    case F_GAMMA: return df_gamma(a);
    default: return df_digamma(a);
    }
}

#endif
