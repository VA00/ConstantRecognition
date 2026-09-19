/* extra_constants.h - Constants beyond the standard CALC4 set
 *
 * Author: Andrzej Odrzywolek
 * Date: September 19, 2026
 * Code assist: Claude Fable 5.1
 *
 * Shared by the real (CALC4.h) and complex (CALC4C.h) calculator tables so
 * the numerical values are defined in exactly one place.
 *
 * These constants have no known algebraic relation with pi, e, phi, the
 * integers, or each other. This makes them useful as "witness" values when
 * checking whether one operation can be expressed through others: if
 * f(GLAISHER) is found to equal some expression in GLAISHER and the other
 * buttons, the identity almost certainly holds for every argument.
 */

#ifndef EXTRA_CONSTANTS_H
#define EXTRA_CONSTANTS_H

/* Glaisher-Kinkelin constant A */
#define GLAISHER_VALUE    1.28242712910062263687534256886979172776768892732500

/* Catalan's constant G */
#define CATALAN_VALUE     0.91596559417721901505460351493238411077414937428167

/* Khinchin's constant K0 */
#define KHINCHIN_VALUE    2.68545200106530644530971483548179569382038229399446

/* Euler-Mascheroni constant gamma */
#define EULERGAMMA_VALUE  0.57721566490153286060651209008240243104215933593992

/* Golden ratio (same literal as CALC4.h, repeated here for CALC4C.h) */
#define GOLDENRATIO_VALUE 1.61803398874989484820458683436563812

#endif /* EXTRA_CONSTANTS_H */
