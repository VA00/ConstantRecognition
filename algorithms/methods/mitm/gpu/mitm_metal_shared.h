// mitm_metal_shared.h - data layouts shared by the Metal kernels (mitm_kernels.metal) and their host (mitm_metal.mm)
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// Kernel arguments are one struct passed by value (setBytes, index 0) holding GPU addresses (MTLBuffer.gpuAddress):
// DPTR(T) is "device T*" in the Metal Shading Language and a 64-bit integer on the host. The buttons are passed at
// index 1 (constant memory). 8-byte members first, so that both compilers lay the structs out alike (the host checks
// the sizes).
#ifndef MITM_METAL_SHARED_H
#define MITM_METAL_SHARED_H
#include "df64.h"

#if defined(__METAL_VERSION__)
#define DPTR(T) device T*
#define DATOM device atomic_uint*                             // 32-bit counters updated atomically
#define DATOMI device atomic_int*
typedef ulong mm_u64;
typedef uint mm_u32;
typedef uchar uchar_t;
#else
#include <cstdint>
#define DPTR(T) uint64_t
#define DATOM uint64_t
#define DATOMI uint64_t
typedef uint64_t mm_u64;
typedef uint32_t mm_u32;
typedef uint8_t uchar_t;
#endif

// a relative error bound e / |R| (units of DBL_EPSILON) in one byte: 0 exact, q > 0: at most 2^((q - 1) / 4)
#define MM_EQ_DECODE(q) ((q) == 0 ? 0.0f : exp2(((float)(q) - 1.0f) * 0.25f))

#define MM_MAXK 12
#define MM_TILE 4096                                           // radix sort: elements per threadgroup (256 x 16)
#define MM_TILE2 2048                                          // radix sort, reordered tiles (256 x 8)
#define MM_SCANB 2048                                          // scan: elements per threadgroup (256 x 8)
#define MM_NONE 0xFFFFFFFFu

// mitm_cr's Form with a fixed layout (216 bytes)
struct GForm {
    mm_u64 stride[MM_MAXK];
    mm_u64 count, offset;
    int radix[MM_MAXK];
    int K, xpos;
    char ar[MM_MAXK], c1[MM_MAXK], c2[MM_MAXK], dual[MM_MAXK];
};

// the buttons: constants as df64 with the error of that representation against the double constant (0 for
// integers), operation codes of the function and operator buttons
struct GGram {
    df64 cval[64];
    float cerr[64];
    int uop[32], bop[8];
    int nc, nu, nb, pad;
};

struct RGenArgs {                                              // right sides: generation
    DPTR(const GForm) forms;
    DPTR(const mm_u64) uoff;                                   // first unit of each form
    DPTR(const mm_u32) usz;                                    // codes per unit of each form
    DATOM hist;                                                // mode 0: count per key bin (key >> 44)
    DPTR(mm_u64) keys;                                         // modes 1, 2: (key, rank) of every usable value
    DPTR(mm_u32) ranks;
    DATOM cnt;                                                 // [0] appended, [1] usable values
    mm_u64 u0, u1;                                             // units of this dispatch
    mm_u32 cap;
    int nforms, mode, b0, b1;                                  // mode 0: count, 1: all, 2: key bins [b0, b1)
    int pad;
};

struct LGenArgs {                                              // left sides: generation, per (target, unit)
    DPTR(const GForm) forms;
    DPTR(const mm_u64) uoff;                                   // units of the forms of this length
    DPTR(const mm_u32) usz;
    DPTR(const mm_u32) act;                                    // open targets (flat target index -> target)
    DPTR(const df64) Tdf;                                      // per target: T as df64
    DPTR(const float) Tres;                                    // per target: T - Tdf (the rounding of T to df64)
    DPTR(df64) V;                                              // value at T (corrected for Tres)
    DPTR(df64) D;                                              // derivative
    DPTR(float) E;                                             // error bound of V (absolute); < 0: beyond errcap
    DPTR(float) EC;                                            // mitm_cr's double-precision error bound of V
    DPTR(mm_u64) LR;                                           // rank
    DPTR(mm_u32) TG;                                           // flat target index - ti0
    DATOM cnt;                                                 // [0] appended, [1] left values, [2] skipped by kappa
    mm_u64 upt, F0, F1, ti0;                                   // units per target; flat units [F0, F1)
    float kmin, kmax, pmax, errcap;
    mm_u32 cap;
    int f0, nf, want_der, bench, pad2;
};

struct SortArgs {                                              // radix sort, one pass of 8 bits
    DPTR(const void) kin;                                      // keys (64 or 32 bits)
    DPTR(const mm_u32) vin;
    DPTR(void) kout;
    DPTR(mm_u32) vout;
    DPTR(mm_u32) hist;                                         // [256][ntiles], scanned between the kernels
    DATOM ghist;                                               // 8 x 256 global counts (k_rs_ghist)
    mm_u64 n;
    mm_u32 ntiles;
    int shift;
};

struct ScanArgs {                                              // exclusive prefix sum of 32-bit counts
    DPTR(const mm_u32) in;
    DPTR(mm_u32) out;                                          // may be in
    DPTR(mm_u32) sums;                                         // per block: total (up), then its prefix (down)
    DPTR(mm_u32) total;                                        // the grand total (down, last block)
    mm_u64 n;
    mm_u32 nblocks, pad;
};

struct DedupRArgs {                                            // right sides: one entry per value, the lowest rank
    DPTR(const mm_u64) K;                                      // sorted keys
    DPTR(const mm_u32) R;                                      // their ranks
    DPTR(mm_u32) flag;                                         // head of a run of equal keys (then scanned: position)
    DPTR(mm_u64) Ko;
    DPTR(mm_u32) Ro;
    mm_u64 n;
};

struct SplitArgs {                                             // right sides of one length (ranks in [lo, hi))
    DPTR(const mm_u64) K;
    DPTR(const mm_u32) R;
    DPTR(mm_u32) flag;
    DPTR(mm_u64) Ko;
    DPTR(mm_u32) Ro;
    mm_u64 n, lo, hi;
};

struct RErrArgs {                                              // right sides: mitm_cr's error bound, quantized
    DPTR(const mm_u32) R;                                      // ranks (sorted: neighbouring threads, similar codes)
    DPTR(const mm_u32) idx;                                    // the entry of each rank in the table
    DPTR(const GForm) forms;
    DPTR(const mm_u64) offs;
    DPTR(uchar_t) out;
    mm_u64 n;
    int nforms, pad;
};

struct LSortArgs {                                             // left sides: keys, gathers, duplicates
    DPTR(const df64) V;
    DPTR(mm_u64) K;                                            // value keys
    DPTR(mm_u32) I;                                            // entry indices (sorted with K)
    DPTR(const mm_u32) TG;
    DPTR(mm_u32) G;                                            // target of each entry in value order
    DPTR(mm_u32) P;                                            // positions in value order (sorted with G)
    DPTR(const mm_u64) LR;
    DPTR(mm_u32) sel;                                          // per sorted position: the selected entry or MM_NONE
    DPTR(mm_u32) flag;
    DPTR(mm_u32) uniq;
    mm_u64 n;
    int bytg, pad;                                             // bytg: sorted by target (G, P valid)
};

struct CandRec {                                               // a pair inside the GPU's window
    mm_u64 lrank;
    mm_u32 rrank, t, k;
    int b;
};

struct ApxRec {                                                // a new closest pair of its total length
    mm_u64 lrank;
    mm_u32 rrank, t, k;
    int b;
    float e, pad;
};

struct AccRec {                                                // an equation accepted in df64 alone (--verify gpu)
    mm_u64 lrank;
    df64 x;                                                    // its root
    float err;                                                 // |x - T| / |T|
    mm_u32 rrank, t, k;
    int b, pad;
};

struct MatchArgs {
    DPTR(const mm_u32) uniq;                                   // distinct left values [k0, k1) of this dispatch
    DPTR(const df64) V;
    DPTR(const df64) D;
    DPTR(const float) E;
    DPTR(const float) EC;
    DPTR(const mm_u64) LR;
    DPTR(const mm_u32) TG;
    DPTR(const mm_u32) act;
    DPTR(const float) absT;                                    // per target
    DATOMI best;                                               // per target: shortest accepted total so far
    DPTR(const int) succ;                                      // per target: accepted in an earlier length
    DATOM apx;                                                 // per (target, total): float bits of the closest e
    DPTR(CandRec) cand;
    DPTR(ApxRec) apr;
    DATOM cnt;                                                 // [0] candidates, [1] approximations, [2] cand_max hits
    DPTR(const mm_u64) Rk[MM_MAXK + 1];                        // per right length: sorted value keys
    DPTR(const float) Rc[MM_MAXK + 1];                         // per right length: double value - df64 value
    DPTR(const mm_u32) Rr[MM_MAXK + 1];                        // per right length: ranks
    mm_u64 Rn[MM_MAXK + 1];
    DPTR(const uchar_t) Re[MM_MAXK + 1];                       // per right length: mitm_cr's error bound, quantized
    DPTR(const uchar_t) Se[MM_MAXK + 1];
    DPTR(const mm_u64) Sk[MM_MAXK + 1];                        // side tables: entries whose double value differs from
    DPTR(const float) Sc[MM_MAXK + 1];                         // their df64 value by more than cw u, keyed by the
    DPTR(const mm_u32) Sr[MM_MAXK + 1];                        // double value (df64 nearest to it, plus residual)
    mm_u64 Sn[MM_MAXK + 1];
    mm_u64 k0, k1, ti0;
    float tol, margin, cw, tolv;                               // window: tol |T| |L'| + margin E; walk: + cw u |L|
    mm_u32 cand_cap, apx_cap;
    int a, KR, NS, cand_max, all_apx, no_apx;
    // --verify gpu: accepted in df64 alone (tolerance tolv relative, Newton steps on the codes)
    DPTR(const GForm) Lf;
    DPTR(const mm_u64) Loff;
    DPTR(const GForm) Rf;
    DPTR(const mm_u64) Roff;
    DPTR(const df64) Tdf;
    DPTR(const float) Tres;
    DPTR(AccRec) acc;
    float errcap;
    mm_u32 acc_cap;
    int nLf, nRf, verify, maxtry;
    int stats, pad3;                                           // stats: window statistics (MITM_METAL_CHECK)
};

struct BenchArgs {                                             // --bench: pairs |L - R| <= tolrel |L|
    DPTR(const mm_u64) keys;                                   // distinct left value keys
    DPTR(mm_u32) pairs;                                        // per left value: the number of pairs
    DPTR(const mm_u64) Rk[MM_MAXK + 1];
    mm_u64 Rn[MM_MAXK + 1];
    mm_u64 n;
    float tolrel;
    int KR;
};

#endif
