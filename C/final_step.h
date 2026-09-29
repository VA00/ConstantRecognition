/* final_step.h - Final step ("Finalize" in the Mathematica package)
 *
 * Author: Andrzej Odrzywolek
 * Date: September 29, 2026
 * Code assist: Claude Opus 5.5
 *
 * Operations applied only to a finished formula, never inside it, so every
 * generated formula stays analytic. Identity is always applied; the flags add
 * -f, Re, Im, |.|, arg. A finished formula f is compared with the target as f
 * and as each enabled phi(f); the closest wins, and on a tie the earlier one
 * in the order Identity, Minus, Re, Im, Abs, Arg. The final step is free: it
 * is not counted in K. In the RPN output it is one more token at the end
 * ("PI, SQRT, RE"; Minus is "MINUS", the name of the sign-change button);
 * Identity adds none.
 *
 * Complex engine: all five. Real engine: Minus, Abs, Arg (Re x = x, Im x = 0).
 *
 * Header-only and free of <complex.h>, so the real engine and MSVC builds
 * share the names and the list parser.
 */

#ifndef FINAL_STEP_H
#define FINAL_STEP_H

#include <stddef.h>
#include <string.h>

#define FINAL_IDENTITY 0u
#define FINAL_RE       1u
#define FINAL_IM       2u
#define FINAL_ABS      4u
#define FINAL_ARG      8u
#define FINAL_MINUS   16u
#define FINAL_ALL      (FINAL_MINUS | FINAL_RE | FINAL_IM | FINAL_ABS | FINAL_ARG)

static const struct { unsigned flag; const char* name; } FINAL_STEP_NAMES[] = {
    { FINAL_MINUS, "MINUS" },
    { FINAL_RE, "RE" }, { FINAL_IM, "IM" }, { FINAL_ABS, "ABS" }, { FINAL_ARG, "ARG" },
};
#define N_FINAL_STEP_NAMES ((int)(sizeof(FINAL_STEP_NAMES) / sizeof(FINAL_STEP_NAMES[0])))

/* Flag of a final-step name (len characters, not necessarily NUL-terminated),
   0 if it is not one */
static inline unsigned final_step_flag(const char* name, size_t len) {
    for (int i = 0; i < N_FINAL_STEP_NAMES; i++) {
        if (strlen(FINAL_STEP_NAMES[i].name) == len && strncmp(FINAL_STEP_NAMES[i].name, name, len) == 0) {
            return FINAL_STEP_NAMES[i].flag;
        }
    }
    return 0;
}

/* RPN token of a final step; NULL for Identity */
static inline const char* final_step_name(unsigned flag) {
    for (int i = 0; i < N_FINAL_STEP_NAMES; i++) {
        if (FINAL_STEP_NAMES[i].flag == flag) return FINAL_STEP_NAMES[i].name;
    }
    return NULL;
}

/* "MINUS,RE,IM" -> flags; NULL or "" -> 0; unknown names are ignored */
static inline unsigned final_step_list(const char* list) {
    unsigned flags = 0;
    if (list == NULL) return 0;
    for (const char* p = list; *p; ) {
        const char* end = strchr(p, ',');
        size_t len = end ? (size_t)(end - p) : strlen(p);
        flags |= final_step_flag(p, len);
        p += len + (end ? 1 : 0);
    }
    return flags;
}

#endif /* FINAL_STEP_H */
