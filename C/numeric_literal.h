/* numeric_literal.h - Plain decimal numbers as calculator constants
 *
 * Author: Andrzej Odrzywolek
 * Date: September 27, 2026
 * Code assist: Claude Opus 5.5
 *
 * A token of a constant list (or of an RPN code) that is not a button name
 * but a plain decimal number, e.g. "29", "0.20787957635076191" or "-2.5e-3",
 * is a constant with that value. strtod rounds correctly, so a 17-digit
 * literal reproduces its double exactly, and JavaScript's parseFloat gives
 * the same double back from the name. The token itself is the constant's
 * name in the RPN output.
 *
 * Header-only (static inline), so every target that parses constant lists
 * gets it without changes to the build.
 */

#ifndef NUMERIC_LITERAL_H
#define NUMERIC_LITERAL_H

#include <stdlib.h>
#include <string.h>
#include <math.h>

/* 1 and *out = value if s is a finite decimal literal, 0 otherwise.
   Only digits, sign, decimal point and exponent are accepted, which keeps
   out strtod's INF, NAN and hexadecimal forms. */
static inline int parse_numeric_literal(const char* s, double* out)
{
    if (s == NULL || *s == '\0') return 0;
    for (const char* p = s; *p; p++) {
        if (strchr("0123456789+-.eE", *p) == NULL) return 0;
    }
    char* end;
    double v = strtod(s, &end);
    if (end == s || *end != '\0' || !isfinite(v)) return 0;
    *out = v;
    return 1;
}

#endif /* NUMERIC_LITERAL_H */
