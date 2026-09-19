/* CALC4C.h - Complex-domain CALC4 calculator plus extra constants
 *
 * Author: Andrzej Odrzywolek
 * Date: September 19, 2026
 * Code assist: Claude Fable 5.1
 *
 * The same 36 buttons as CALC4.h, evaluated in the complex plane, plus six
 * constants, one function and one operator that CALC4 does not have:
 *
 *   ZERO        - 0
 *   I           - imaginary unit
 *   GLAISHER    - Glaisher-Kinkelin constant A
 *   CATALAN     - Catalan's constant G
 *   KHINCHIN    - Khinchin's constant K0
 *   EULERGAMMA  - Euler-Mascheroni constant gamma
 *   MINUS       - sign change, Minus[x] = -x
 *   LOGARITHM   - logarithm to an arbitrary base, Log[base, x]
 *
 * Button names are identical to CALC4.h, so RPN codes produced by either
 * engine are interchangeable. The first CALC4C_N_CORE_CONST constants are
 * exactly CALC4_CONSTS.
 *
 * Usage:
 *   #include "CALC4C.h"
 *   search_constant_complex(z, 0.0, 1, 7, 0, 1,
 *       CALC4C_CONSTS, CALC4C_N_CONST,
 *       CALC4C_FUNCS,  CALC4C_N_UNARY,
 *       CALC4C_OPS,    CALC4C_N_BINARY, 0.0);
 */

#ifndef CALC4C_H
#define CALC4C_H

#ifndef _MSC_VER

#define _USE_MATH_DEFINES
#include <math.h>
#include <complex.h>
#include "vsearch_RPN_complex.h"
#include "cmath2.h"
#include "extra_constants.h"

#ifndef ARRAY_SIZE
#define ARRAY_SIZE(arr) (sizeof(arr) / sizeof((arr)[0]))
#endif

/* ============================================================================
 * CONSTANTS (13 CALC4 + 6 extra)
 * ============================================================================ */

static const CConstOp CALC4C_CONSTS[] = {
    { M_PI,              "PI"          },
    { M_E,               "EULER"       },
    { -1.0,              "NEG"         },
    { GOLDENRATIO_VALUE, "GOLDENRATIO" },
    { 1.0,               "ONE"         },
    { 2.0,               "TWO"         },
    { 3.0,               "THREE"       },
    { 4.0,               "FOUR"        },
    { 5.0,               "FIVE"        },
    { 6.0,               "SIX"         },
    { 7.0,               "SEVEN"       },
    { 8.0,               "EIGHT"       },
    { 9.0,               "NINE"        },
    /* --- beyond CALC4 --- */
    { 0.0,               "ZERO"        },
    { I,                 "I"           },
    { GLAISHER_VALUE,    "GLAISHER"    },
    { CATALAN_VALUE,     "CATALAN"     },
    { KHINCHIN_VALUE,    "KHINCHIN"    },
    { EULERGAMMA_VALUE,  "EULERGAMMA"  }
};

#define CALC4C_N_CONST      ((int)ARRAY_SIZE(CALC4C_CONSTS))
#define CALC4C_N_CORE_CONST 13

/* ============================================================================
 * UNARY FUNCTIONS (18 CALC4 + 1 extra)
 * ============================================================================ */

static const CUnaryOp CALC4C_FUNCS[] = {
    { c_log,   "LOG"     },
    { c_exp,   "EXP"     },
    { c_inv,   "INV"     },
    { c_gamma, "GAMMA"   },
    { c_sqrt,  "SQRT"    },
    { c_sqr,   "SQR"     },
    { c_sin,   "SIN"     },
    { c_asin,  "ARCSIN"  },
    { c_cos,   "COS"     },
    { c_acos,  "ARCCOS"  },
    { c_tan,   "TAN"     },
    { c_atan,  "ARCTAN"  },
    { c_sinh,  "SINH"    },
    { c_asinh, "ARCSINH" },
    { c_cosh,  "COSH"    },
    { c_acosh, "ARCCOSH" },
    { c_tanh,  "TANH"    },
    { c_atanh, "ARCTANH" },
    /* --- beyond CALC4: sign change, Minus[x] = -x --- */
    { c_minus, "MINUS"   }
};

#define CALC4C_N_UNARY      ((int)ARRAY_SIZE(CALC4C_FUNCS))
#define CALC4C_N_CORE_UNARY 18

/* ============================================================================
 * BINARY OPERATORS (5 CALC4 + 1 extra)
 * ============================================================================ */

static const CBinaryOp CALC4C_OPS[] = {
    { c_plus,      "PLUS"      },
    { c_times,     "TIMES"     },
    { c_subtract,  "SUBTRACT"  },
    { c_divide,    "DIVIDE"    },
    { c_power,     "POWER"     },
    /* --- beyond CALC4: "a, b, LOGARITHM" = log_b(a), base pushed last --- */
    { c_logarithm, "LOGARITHM" }
};

#define CALC4C_N_BINARY      ((int)ARRAY_SIZE(CALC4C_OPS))
#define CALC4C_N_CORE_BINARY 5

#define CALC4C_N_TOTAL (CALC4C_N_CONST + CALC4C_N_UNARY + CALC4C_N_BINARY)

#endif /* !_MSC_VER */
#endif /* CALC4C_H */
