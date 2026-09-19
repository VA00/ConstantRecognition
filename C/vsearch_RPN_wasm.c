/* vsearch_RPN_wasm.c - WASM wrapper for JS frontend
 *
 * Author: Andrzej Odrzywolek, andrzej.odrzywolek@uj.edu.pl
 * Date: January 2, 2025 (complex domain added September 19, 2026)
 *
 * This file provides:
 *   - String parsing for runtime-configurable calculators
 *   - WASM exported functions for JavaScript frontend (real and complex)
 *   - Backward compatibility with existing web interface
 *
 * Compilation: see `make wasm` in Makefile (or compile.bat on Windows).
 *
 * WebAssembly (emcc, Windows):
 * Install emsdk
 *
 * git clone https://github.com/emscripten-core/emsdk.git
 * cd emsdk
 * emsdk> .\emsdk install latest
 *        .\emsdk activate latest
 */

#ifdef _WIN32
#define strdup _strdup
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include "vsearch_RPN_core.h"
#include "CALC4.h"

/* ============================================================================
 * STRING-BASED WRAPPER (real domain)
 * Parses comma-separated strings -> calls core with arrays
 * Uses .name fields from CALC4 tables - no duplication!
 * ============================================================================ */

#define MAX_OPS 64

/* Resolves comma-separated button names into CALC4 (+ extra) table entries.
   NULL means "all CALC4 buttons of that kind", "" means none. */
static void build_tables(
    const char* const_list, const char* fun_list, const char* op_list,
    ConstOp* const_ops, int* out_n_const,
    UnaryOp* unary_ops, int* out_n_unary,
    BinaryOp* binary_ops, int* out_n_binary)
{
    int n_const = 0;
    int n_unary = 0;
    int n_binary = 0;
    
    /* Parse constants (or use all CALC4 constants if NULL).
       Names are looked up in CALC4_CONSTS first, then in CALC4_EXTRA_CONSTS. */
    if (const_list == NULL) {
        n_const = CALC4_N_CONST;
        for (int i = 0; i < CALC4_N_CONST; i++) {
            const_ops[i] = CALC4_CONSTS[i];
        }
    } else if (const_list[0] != '\0') {
        char* copy = strdup(const_list);
        char* token = strtok(copy, ",");
        while (token != NULL && n_const < MAX_OPS) {
            int found = 0;
            for (int i = 0; i < CALC4_N_CONST && !found; i++) {
                if (strcmp(token, CALC4_CONSTS[i].name) == 0) {
                    const_ops[n_const++] = CALC4_CONSTS[i];
                    found = 1;
                }
            }
            for (int i = 0; i < CALC4_N_EXTRA_CONST && !found; i++) {
                if (strcmp(token, CALC4_EXTRA_CONSTS[i].name) == 0) {
                    const_ops[n_const++] = CALC4_EXTRA_CONSTS[i];
                    found = 1;
                }
            }
            token = strtok(NULL, ",");
        }
        free(copy);
    }
    
    /* Parse unary functions (or use all if NULL) */
    if (fun_list == NULL) {
        n_unary = CALC4_N_UNARY;
        for (int i = 0; i < CALC4_N_UNARY; i++) {
            unary_ops[i] = CALC4_FUNCS[i];
        }
    } else if (fun_list[0] != '\0') {
        char* copy = strdup(fun_list);
        char* token = strtok(copy, ",");
        while (token != NULL && n_unary < MAX_OPS) {
            int found = 0;
            for (int i = 0; i < CALC4_N_UNARY && !found; i++) {
                if (strcmp(token, CALC4_FUNCS[i].name) == 0) {
                    unary_ops[n_unary++] = CALC4_FUNCS[i];
                    found = 1;
                }
            }
            for (int i = 0; i < CALC4_N_EXTRA_UNARY && !found; i++) {
                if (strcmp(token, CALC4_EXTRA_FUNCS[i].name) == 0) {
                    unary_ops[n_unary++] = CALC4_EXTRA_FUNCS[i];
                    found = 1;
                }
            }
            token = strtok(NULL, ",");
        }
        free(copy);
    }
    
    /* Parse binary operators (or use all if NULL) */
    if (op_list == NULL) {
        n_binary = CALC4_N_BINARY;
        for (int i = 0; i < CALC4_N_BINARY; i++) {
            binary_ops[i] = CALC4_OPS[i];
        }
    } else if (op_list[0] != '\0') {
        char* copy = strdup(op_list);
        char* token = strtok(copy, ",");
        while (token != NULL && n_binary < MAX_OPS) {
            int found = 0;
            for (int i = 0; i < CALC4_N_BINARY && !found; i++) {
                if (strcmp(token, CALC4_OPS[i].name) == 0) {
                    binary_ops[n_binary++] = CALC4_OPS[i];
                    found = 1;
                }
            }
            for (int i = 0; i < CALC4_N_EXTRA_BINARY && !found; i++) {
                if (strcmp(token, CALC4_EXTRA_OPS[i].name) == 0) {
                    binary_ops[n_binary++] = CALC4_EXTRA_OPS[i];
                    found = 1;
                }
            }
            token = strtok(NULL, ",");
        }
        free(copy);
    }
    
    *out_n_const = n_const;
    *out_n_unary = n_unary;
    *out_n_binary = n_binary;
}

char* vsearch_RPN(
    double z, double dz,
    int MinK, int MaxK,
    int cpu_id, int ncpus,
    const char* const_list,   /* comma-separated, e.g. "PI,EULER,ONE" or NULL for all */
    const char* fun_list,     /* comma-separated, e.g. "LOG,EXP,SQRT" or NULL for all */
    const char* op_list)      /* comma-separated, e.g. "PLUS,TIMES" or NULL for all */
{
    ConstOp const_ops[MAX_OPS];
    UnaryOp unary_ops[MAX_OPS];
    BinaryOp binary_ops[MAX_OPS];
    int n_const, n_unary, n_binary;
    build_tables(const_list, fun_list, op_list, const_ops, &n_const, unary_ops, &n_unary, binary_ops, &n_binary);
    return search_constant(z, dz, MinK, MaxK, cpu_id, ncpus,
                          const_ops, n_const,
                          unary_ops, n_unary,
                          binary_ops, n_binary,
                          ERROR_REL, COMPARE_STRICT);
}

/* Same, with the compression-ratio threshold for tolerance-based early exit */
char* vsearch_RPN_cr(
    double z, double dz,
    int MinK, int MaxK,
    int cpu_id, int ncpus,
    const char* const_list,
    const char* fun_list,
    const char* op_list,
    double cr_threshold)
{
    ConstOp const_ops[MAX_OPS];
    UnaryOp unary_ops[MAX_OPS];
    BinaryOp binary_ops[MAX_OPS];
    int n_const, n_unary, n_binary;
    build_tables(const_list, fun_list, op_list, const_ops, &n_const, unary_ops, &n_unary, binary_ops, &n_binary);
    return search_constant_with_cr(z, dz, MinK, MaxK, cpu_id, ncpus,
                          const_ops, n_const,
                          unary_ops, n_unary,
                          binary_ops, n_binary,
                          ERROR_REL, COMPARE_STRICT, cr_threshold);
}

/* ============================================================================
 * STRING-BASED WRAPPER (complex domain)
 * Same list syntax; names resolved in the CALC4C tables, which also know
 * ZERO, I, GLAISHER, CATALAN, KHINCHIN, EULERGAMMA, MINUS and LOGARITHM.
 * ============================================================================ */

#ifndef _MSC_VER

#include <complex.h>
#include "vsearch_RPN_complex.h"
#include "CALC4C.h"

char* vsearch_RPN_complex(
    double z_re, double z_im, double dz,
    int MinK, int MaxK,
    int cpu_id, int ncpus,
    const char* const_list,
    const char* fun_list,
    const char* op_list,
    double cr_threshold)
{
    CConstOp const_ops[MAX_OPS];
    CUnaryOp unary_ops[MAX_OPS];
    CBinaryOp binary_ops[MAX_OPS];
    int n_const = 0, n_unary = 0, n_binary = 0;

    if (const_list == NULL) {
        n_const = CALC4C_N_CONST;
        for (int i = 0; i < CALC4C_N_CONST; i++) const_ops[i] = CALC4C_CONSTS[i];
    } else if (const_list[0] != '\0') {
        char* copy = strdup(const_list);
        char* token = strtok(copy, ",");
        while (token != NULL && n_const < MAX_OPS) {
            for (int i = 0; i < CALC4C_N_CONST; i++) {
                if (strcmp(token, CALC4C_CONSTS[i].name) == 0) {
                    const_ops[n_const++] = CALC4C_CONSTS[i];
                    break;
                }
            }
            token = strtok(NULL, ",");
        }
        free(copy);
    }

    if (fun_list == NULL) {
        n_unary = CALC4C_N_UNARY;
        for (int i = 0; i < CALC4C_N_UNARY; i++) unary_ops[i] = CALC4C_FUNCS[i];
    } else if (fun_list[0] != '\0') {
        char* copy = strdup(fun_list);
        char* token = strtok(copy, ",");
        while (token != NULL && n_unary < MAX_OPS) {
            for (int i = 0; i < CALC4C_N_UNARY; i++) {
                if (strcmp(token, CALC4C_FUNCS[i].name) == 0) {
                    unary_ops[n_unary++] = CALC4C_FUNCS[i];
                    break;
                }
            }
            token = strtok(NULL, ",");
        }
        free(copy);
    }

    if (op_list == NULL) {
        n_binary = CALC4C_N_BINARY;
        for (int i = 0; i < CALC4C_N_BINARY; i++) binary_ops[i] = CALC4C_OPS[i];
    } else if (op_list[0] != '\0') {
        char* copy = strdup(op_list);
        char* token = strtok(copy, ",");
        while (token != NULL && n_binary < MAX_OPS) {
            for (int i = 0; i < CALC4C_N_BINARY; i++) {
                if (strcmp(token, CALC4C_OPS[i].name) == 0) {
                    binary_ops[n_binary++] = CALC4C_OPS[i];
                    break;
                }
            }
            token = strtok(NULL, ",");
        }
        free(copy);
    }

    return search_constant_complex(z_re + z_im * I, dz, MinK, MaxK, cpu_id, ncpus,
                                   const_ops, n_const,
                                   unary_ops, n_unary,
                                   binary_ops, n_binary,
                                   cr_threshold);
}

#endif /* !_MSC_VER */

/* ============================================================================
 * WASM EXPORTED FUNCTIONS
 * ============================================================================ */

#ifdef __EMSCRIPTEN__
#include <emscripten.h>

/* Legacy API: uses full CALC4 calculator */
EMSCRIPTEN_KEEPALIVE
char* search_RPN(double z, double dz, int MinK, int MaxK, int cpu_id, int ncpus) {
    return search_constant(z, dz, MinK, MaxK, cpu_id, ncpus,
                          CALC4_CONSTS, CALC4_N_CONST,
                          CALC4_FUNCS,  CALC4_N_UNARY,
                          CALC4_OPS,    CALC4_N_BINARY,
                          ERROR_REL, COMPARE_STRICT);
}

EMSCRIPTEN_KEEPALIVE
char* search_RPN_with_cr(double z, double dz, int MinK, int MaxK, int cpu_id, int ncpus, double cr_threshold) {
    return search_constant_with_cr(z, dz, MinK, MaxK, cpu_id, ncpus,
                          CALC4_CONSTS, CALC4_N_CONST,
                          CALC4_FUNCS,  CALC4_N_UNARY,
                          CALC4_OPS,    CALC4_N_BINARY,
                          ERROR_REL, COMPARE_STRICT, cr_threshold);
}

/* Hybrid search (same as search_RPN for now - placeholder for FP32+FP64) */
EMSCRIPTEN_KEEPALIVE
char* search_RPN_hybrid(double z, double dz, int MinK, int MaxK, int cpu_id, int ncpus) {
    return search_constant(z, dz, MinK, MaxK, cpu_id, ncpus,
                          CALC4_CONSTS, CALC4_N_CONST,
                          CALC4_FUNCS,  CALC4_N_UNARY,
                          CALC4_OPS,    CALC4_N_BINARY,
                          ERROR_REL, COMPARE_STRICT);
}

/* Configurable search via strings */
EMSCRIPTEN_KEEPALIVE
char* search_RPN_custom(double z, double dz, int MinK, int MaxK, int cpu_id, int ncpus,
                        const char* consts, const char* funcs, const char* ops) {
    return vsearch_RPN(z, dz, MinK, MaxK, cpu_id, ncpus, consts, funcs, ops);
}

/* Configurable search via strings, honouring the CR early-exit threshold */
EMSCRIPTEN_KEEPALIVE
char* search_RPN_custom_cr(double z, double dz, int MinK, int MaxK, int cpu_id, int ncpus,
                           const char* consts, const char* funcs, const char* ops, double cr_threshold) {
    return vsearch_RPN_cr(z, dz, MinK, MaxK, cpu_id, ncpus, consts, funcs, ops, cr_threshold);
}

/* Complex-domain configurable search. Target is z_re + i z_im. */
EMSCRIPTEN_KEEPALIVE
char* search_RPN_complex(double z_re, double z_im, double dz, int MinK, int MaxK, int cpu_id, int ncpus,
                         const char* consts, const char* funcs, const char* ops, double cr_threshold) {
    return vsearch_RPN_complex(z_re, z_im, dz, MinK, MaxK, cpu_id, ncpus, consts, funcs, ops, cr_threshold);
}

/* Evaluate a named RPN code (e.g. "I, NEG, LOG, DIVIDE") in the complex
   domain using every button CALC4C knows. Returns JSON:
     {"ok":1, "finite":1, "re":..., "im":...}   on success
     {"ok":1, "finite":0}                        value overflowed / undefined
     {"ok":0}                                    unknown token or bad syntax
   Caller must free(). */
EMSCRIPTEN_KEEPALIVE
char* evaluate_RPN_complex(const char* rpn) {
    char* out = (char*)malloc(160);
    if (!out) return NULL;
    double complex v;
    int ok = evaluate_rpn_complex(rpn,
                                  CALC4C_CONSTS, CALC4C_N_CONST,
                                  CALC4C_FUNCS,  CALC4C_N_UNARY,
                                  CALC4C_OPS,    CALC4C_N_BINARY, &v);
    if (!ok) {
        snprintf(out, 160, "{\"ok\":0}");
    } else if (!isfinite(creal(v)) || !isfinite(cimag(v))) {
        snprintf(out, 160, "{\"ok\":1, \"finite\":0}");
    } else {
        snprintf(out, 160, "{\"ok\":1, \"finite\":1, \"re\":%.17g, \"im\":%.17g}", creal(v), cimag(v));
    }
    return out;
}

/* Function recognition via WASM */
EMSCRIPTEN_KEEPALIVE
char* search_function_wasm(
    const double* x_values, const double* y_values, const double* dy_values,
    int n_data,
    int MinK, int MaxK,
    int cpu_id, int ncpus)
{
    /* Convert arrays to DataPoint array */
    DataPoint* data = (DataPoint*)malloc(n_data * sizeof(DataPoint));
    if (!data) {
        return strdup("{\"error\":\"Memory allocation failed\"}");
    }
    
    for (int i = 0; i < n_data; i++) {
        data[i].x = x_values[i];
        data[i].y = y_values[i];
        data[i].dy = (dy_values != NULL) ? dy_values[i] : 0.0;
    }
    
    char* result = search_function(
        data, n_data,
        MinK, MaxK,
        cpu_id, ncpus,
        CALC4_CONSTS, CALC4_N_CONST,
        CALC4_FUNCS,  CALC4_N_UNARY,
        CALC4_OPS,    CALC4_N_BINARY,
        ERROR_MSE, COMPARE_STRICT);
    
    free(data);
    return result;
}

/* Batch (Multiple Constants) recognition via WASM */
EMSCRIPTEN_KEEPALIVE
char* search_batch_wasm(
    const double* x_values, const double* y_values, const double* dy_values,
    int n_data,
    int MinK, int MaxK,
    int cpu_id, int ncpus)
{
    /* Convert arrays to DataPoint array */
    DataPoint* data = (DataPoint*)malloc(n_data * sizeof(DataPoint));
    if (!data) {
        return strdup("{\"error\":\"Memory allocation failed\"}");
    }
    
    for (int i = 0; i < n_data; i++) {
        data[i].x = x_values[i];
        data[i].y = y_values[i];
        data[i].dy = (dy_values != NULL) ? dy_values[i] : 0.0;
    }
    
    char* result = search_batch(
        data, n_data,
        n_data, /* num_to_find */
        MinK, MaxK,
        cpu_id, ncpus,
        CALC4_CONSTS, CALC4_N_CONST,
        CALC4_FUNCS,  CALC4_N_UNARY,
        CALC4_OPS,    CALC4_N_BINARY,
        ERROR_REL, COMPARE_STRICT);
    
    free(data);
    return result;
}

#endif /* __EMSCRIPTEN__ */
