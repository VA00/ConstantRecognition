// mitm_kernels.metal - the kernels of the meet-in-the-middle search on Apple GPUs (host: mitm_metal.mm)
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// Compiled at run time (MTLDevice newLibraryWithSource) from one string: df64.h, df64_ops.h, mitm_metal_shared.h and
// this file, concatenated by embed_metal.sh (local includes dropped), after "#include <metal_stdlib>". Numbers are
// df64 (no double on Apple GPUs); the kernels only find candidates, the host decides in double precision.
//
//   k_gen_r       right sides: each thread an odometer over a unit of consecutive codes of one form (mitm_cr's
//                 enum_R; units are multiples of the radices of the last positions, so the lanes of a SIMD group
//                 apply the same buttons together); counts per key bin, or appends (key, rank)
//   k_rs_*        LSD radix sort of (key, 32-bit value) pairs, 8 bits per pass, stable: per tile a histogram, a
//                 global scan of the [digit][tile] counts, then a scatter that ranks equal digits inside a SIMD group
//                 with ballots (no library sort on Metal)
//   k_scan_*      exclusive prefix sums (positions of the entries kept by a compaction)
//   k_dedup_r, k_split_*  one entry per value (the lowest rank, i.e. the shortest code), then one table per length
//   k_gen_l       left sides per (target, unit), with derivatives, a running error bound and enum_L's guards
//   k_lkeys ... k_dedup_l  left values sorted by value, then stably by target; per (target, value) the lowest rank
//   k_r_err       mitm_cr's error bound of every right side, in one byte (for the noise check of the closest pairs)
//   k_match       per distinct left value and right length: the window |L - R| <= tol |T| |L'| + margin E, where R
//                 is the double value of the right side (df64 value plus the host's correction; main and side tables)
//                 and E bounds the df64 error of L; candidates for the host, closest pairs for the FAILURE lines;
//                 with --verify gpu, Newton steps and acceptance in df64 alone (verify_left)
//   k_bench_pairs --bench
#include "df64_ops.h"
#include "mitm_metal_shared.h"

#define MM_INTMAX 0x7FFFFFFF

static inline uint find_le(device const ulong* a, uint n, ulong x)   // last i in [0, n) with a[i] <= x (a[0] <= x)
{
    uint lo = 0, hi = n;
    while (hi - lo > 1) {
        const uint m = (lo + hi) >> 1;
        if (a[m] <= x) lo = m; else hi = m;
    }
    return lo;
}

// Per-thread arrays are sized to the longest code of the run (MM_LK left, MM_RK right sides; set by the host when it
// compiles the kernels), digits are bytes, and forms are read in place: the less private memory a thread needs, the
// more threads the GPU keeps in flight (Apple GPUs allocate registers dynamically, out of the L1 cache)
#ifndef MM_LK
#define MM_LK MM_MAXK
#endif
#ifndef MM_RK
#define MM_RK MM_MAXK
#endif
#define MM_EK (MM_LK > MM_RK ? MM_LK : MM_RK)

static inline void decode(device const GForm* f, ulong idx, thread uchar* dig)
{
    for (int i = f->K - 1; i >= 0; i--) {
        const ulong r = (ulong)f->radix[i];
        dig[i] = (uchar)(idx % r);
        idx /= r;
    }
}

static inline int odo_step(thread uchar* dig, device const GForm* f)   // next code; the lowest position changed
{
    int i = f->K - 1;
    while (++dig[i] == f->radix[i]) { dig[i] = 0; i--; }
    return i;
}

static inline ulong df_key(df64 v)
{
    v = dfo_norm0(v);
    return ((ulong)dfo_ord(v.hi) << 32) | (ulong)dfo_ord(v.lo);
}
static inline df64 df_unkey(ulong k) { return df_make(dfo_unord((uint)(k >> 32)), dfo_unord((uint)k)); }

// position of this lane's entry in an output array shared by all threads (one atomic per SIMD group); every lane
// of the SIMD group must call it
static inline uint simd_append(bool has, device atomic_uint* counter)
{
    const uint pre = simd_prefix_exclusive_sum(has ? 1u : 0u);
    const uint tot = simd_sum(has ? 1u : 0u);
    uint base = 0;
    if (simd_is_first() && tot != 0) base = atomic_fetch_add_explicit(counter, tot, memory_order_relaxed);
    return simd_broadcast_first(base) + pre;
}

static inline void simd_count(uint v, device atomic_uint* counter)
{
    const uint s = simd_sum(v);
    if (simd_is_first() && s != 0) atomic_fetch_add_explicit(counter, s, memory_order_relaxed);
}

static inline bool periodic(int op) { return op == DU_SIN || op == DU_COS || op == DU_TAN; }

#define MM_EPS 2.220446049250313e-16f                          // DBL_EPSILON

// mitm_cr's eval_full: the error of one operation in double, in units of DBL_EPSILON relative to the result
static inline float w_cpu_un(int op)
{
    return op == DU_GAMMA ? 4.0f : op == DU_MINUS ? 0.0f : (op == DU_INV || op == DU_SQR || op == DU_SQRT) ? 0.5f : 1.0f;
}
static inline float w_cpu_bin(int op)
{
    return (op == DB_LOGARITHM || op == DB_ROOT) ? 2.0f : (op == DB_POWER || op == DB_ATAN2) ? 1.0f : 0.5f;
}

// an input's error times the partial derivative (as mitm_cr's eval_full: zero for an exact input, so that asin(1),
// with its infinite derivative, stays exact); inf when not finite
static inline float prop(float partial, float ein)
{
    if (ein == 0.0f) return 0.0f;
    const float p = fabs(partial) * ein;
    return isfinite(p) ? p : df_inf();
}

// mitm_cr's eval_full takes the partial derivative of t^s by s as r log t: NaN for a negative base t (an integer
// exponent), so the bound is NaN whenever the exponent carries an error; such a code is never accepted (errcap) and
// never a closest pair (noise check) there. The GPU's bounds follow it (inf)
static inline bool cpu_bound_nan(int op, df64 t, float es) { return op == DB_POWER && t.hi < 0.0f && es != 0.0f; }

static inline bool abs_gt(df64 a, float x)                     // |a| > x for x > 0
{
    if (a.hi < 0.0f) a = df_neg(a);
    return a.hi > x || (a.hi == x && a.lo > 0.0f);
}

// ------------------------------------------------------------------------------------------------ right sides

kernel void k_gen_r(constant RGenArgs& A [[buffer(0)]], constant GGram& g [[buffer(1)]],
                    uint gid [[thread_position_in_grid]])
{
    const ulong u = A.u0 + gid;
    uchar dig[MM_RK];
    df64 val[MM_RK];
    int bad = 0, n = 0;
    device const GForm* F = A.forms;
    ulong r0 = 0;
    if (u < A.u1) {
        const uint fi = find_le(A.uoff, (uint)A.nforms, u);
        F = A.forms + fi;
        r0 = (u - A.uoff[fi]) * (ulong)A.usz[fi];
        const ulong left = F->count - r0;
        n = (int)(left < (ulong)A.usz[fi] ? left : (ulong)A.usz[fi]);
        decode(F, r0, dig);
    }
    uint nf = 0;
    for (int st = 0; simd_any(st < n); st++) {
        bool has = false;
        ulong key = 0;
        if (st < n) {
            const int p = st != 0 ? odo_step(dig, F) : 0;
            if (p <= bad) {
                int i = p;
                for (; i < F->K; i++) {
                    const int d = dig[i];
                    df64 r;
                    if (F->ar[i] == 0) r = g.cval[d];
                    else if (F->ar[i] == 1) r = dfo_un(g.uop[d], val[i - 1]);
                    else r = dfo_bin(g.bop[d], val[(int)F->c1[i]], val[(int)F->c2[i]]);
                    if (!dfo_usable(r)) break;                 // skip every completion of this prefix
                    val[i] = r;
                }
                bad = i;
                has = i == F->K;
            }
            if (has) { nf++; key = df_key(val[F->K - 1]); }
        }
        if (A.mode == 0) {
            if (has) atomic_fetch_add_explicit(A.hist + (key >> 44), 1u, memory_order_relaxed);
            continue;
        }
        if (has && A.mode == 2) { const int b = (int)(key >> 44); has = b >= A.b0 && b < A.b1; }
        const uint pos = simd_append(has, A.cnt);
        if (has && pos < A.cap) { A.keys[pos] = key; A.ranks[pos] = (uint)(F->offset + r0 + (ulong)st); }
    }
    simd_count(nf, A.cnt + 1);
}

// ------------------------------------------------------------------------------------------------ radix sort

// the 8 histograms of a 64-bit key (to skip the passes whose digit is the same for all keys)
kernel void k_rs_ghist(constant SortArgs& A [[buffer(0)]], uint gid [[thread_position_in_grid]],
                       uint tid [[thread_position_in_threadgroup]], uint ngrid [[threads_per_grid]])
{
    threadgroup atomic_uint h[8 * 256];
    for (uint i = tid; i < 8 * 256; i += 256) atomic_store_explicit(&h[i], 0u, memory_order_relaxed);
    threadgroup_barrier(mem_flags::mem_threadgroup);
    device const ulong* k = (device const ulong*)A.kin;
    for (ulong i = gid; i < A.n; i += ngrid) {
        const ulong x = k[i];
        for (int d = 0; d < 8; d++) atomic_fetch_add_explicit(&h[d * 256 + (uint)((x >> (8 * d)) & 255)], 1u, memory_order_relaxed);
    }
    threadgroup_barrier(mem_flags::mem_threadgroup);
    for (uint i = tid; i < 8 * 256; i += 256) {
        const uint c = atomic_load_explicit(&h[i], memory_order_relaxed);
        if (c) atomic_fetch_add_explicit(A.ghist + i, c, memory_order_relaxed);
    }
}

template <typename KT>
static inline void rs_hist(constant SortArgs& A, uint tid, uint bid, threadgroup atomic_uint* h)
{
    atomic_store_explicit(&h[tid], 0u, memory_order_relaxed);
    threadgroup_barrier(mem_flags::mem_threadgroup);
    device const KT* k = (device const KT*)A.kin;
    const ulong base = (ulong)bid * MM_TILE;
    for (int r = 0; r < MM_TILE / 256; r++) {
        const ulong i = base + (ulong)r * 256 + tid;
        if (i < A.n) atomic_fetch_add_explicit(&h[(uint)((k[i] >> A.shift) & 255)], 1u, memory_order_relaxed);
    }
    threadgroup_barrier(mem_flags::mem_threadgroup);
    A.hist[(ulong)tid * A.ntiles + bid] = atomic_load_explicit(&h[tid], memory_order_relaxed);
}

kernel void k_rs_hist64(constant SortArgs& A [[buffer(0)]], uint tid [[thread_position_in_threadgroup]],
                        uint bid [[threadgroup_position_in_grid]])
{
    threadgroup atomic_uint h[256];
    rs_hist<ulong>(A, tid, bid, h);
}

kernel void k_rs_hist32(constant SortArgs& A [[buffer(0)]], uint tid [[thread_position_in_threadgroup]],
                        uint bid [[threadgroup_position_in_grid]])
{
    threadgroup atomic_uint h[256];
    rs_hist<uint>(A, tid, bid, h);
}

// stable scatter of one tile: rounds of 256 elements in order; inside a round, the lanes of a SIMD group with the
// same digit are found by 9 ballots (digit 256 = past the end), and the SIMD groups are ranked through threadgroup
// memory, so every element keeps its order among the elements of its digit
template <typename KT>
static inline void rs_scatter(constant SortArgs& A, uint tid, uint bid, uint lane, uint sg,
                              threadgroup uint* off, threadgroup uint* cnt)
{
    device const KT* kin = (device const KT*)A.kin;
    device KT* kout = (device KT*)A.kout;
    off[tid] = A.hist[(ulong)tid * A.ntiles + bid];
    const ulong base = (ulong)bid * MM_TILE;
    const ulong below_mask = (1ul << lane) - 1ul;
    for (int r = 0; r < MM_TILE / 256; r++) {
        const ulong i = base + (ulong)r * 256 + tid;
        const bool valid = i < A.n;
        KT key = 0;
        uint val = 0;
        if (valid) { key = kin[i]; val = A.vin[i]; }
        const uint dg = valid ? (uint)((key >> A.shift) & 255) : 256u;
        ulong peers = 0xFFFFFFFFul;
        for (int b = 0; b < 9; b++) {
            const bool set = ((dg >> b) & 1u) != 0;
            const ulong vote = (ulong)(simd_vote::vote_t)simd_ballot(set);
            peers &= set ? vote : ~vote;
        }
        peers &= 0xFFFFFFFFul;
        const uint below = popcount(peers & below_mask);
        for (uint j = tid; j < 8 * 256; j += 256) cnt[j] = 0;
        threadgroup_barrier(mem_flags::mem_threadgroup);
        if (valid && below == 0) cnt[sg * 256 + dg] = popcount(peers);
        threadgroup_barrier(mem_flags::mem_threadgroup);
        {                                                      // thread tid: digit tid over the 8 SIMD groups
            uint run = off[tid];
            for (uint s = 0; s < 8; s++) {
                const uint c = cnt[s * 256 + tid];
                cnt[s * 256 + tid] = run;
                run += c;
            }
            off[tid] = run;
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
        if (valid) {
            const uint pos = cnt[sg * 256 + dg] + below;
            kout[pos] = key;
            A.vout[pos] = val;
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }
}

kernel void k_rs_scatter64(constant SortArgs& A [[buffer(0)]], uint tid [[thread_position_in_threadgroup]],
                           uint bid [[threadgroup_position_in_grid]], uint lane [[thread_index_in_simdgroup]],
                           uint sg [[simdgroup_index_in_threadgroup]])
{
    threadgroup uint off[256];
    threadgroup uint cnt[8 * 256];
    rs_scatter<ulong>(A, tid, bid, lane, sg, off, cnt);
}

kernel void k_rs_scatter32(constant SortArgs& A [[buffer(0)]], uint tid [[thread_position_in_threadgroup]],
                           uint bid [[threadgroup_position_in_grid]], uint lane [[thread_index_in_simdgroup]],
                           uint sg [[simdgroup_index_in_threadgroup]])
{
    threadgroup uint off[256];
    threadgroup uint cnt[8 * 256];
    rs_scatter<uint>(A, tid, bid, lane, sg, off, cnt);
}

// The same scatter for tiles of MM_TILE2 elements, reordered in threadgroup memory first, so that the elements of one
// digit leave the tile as one contiguous run (coalesced writes); stable as above. The tile histogram comes from
// k_rs_hist2 (hist2: [256][ntiles], scanned).
template <typename KT>
static inline void rs_scatter2(constant SortArgs& A, uint tid, uint bid, uint lane, uint sg, threadgroup KT* buf,
                               threadgroup uchar* dbuf, threadgroup uint* lstart, threadgroup uint* off,
                               threadgroup uint* run, threadgroup ushort* cnt, threadgroup atomic_uint* h)
{
    device const KT* kin = (device const KT*)A.kin;
    device KT* kout = (device KT*)A.kout;
    const ulong base = (ulong)bid * MM_TILE2;
    const uint nt = (uint)min((ulong)MM_TILE2, A.n - base);
    // the digits of this tile: local histogram -> local starts
    atomic_store_explicit(&h[tid], 0u, memory_order_relaxed);
    threadgroup_barrier(mem_flags::mem_threadgroup);
    KT key[MM_TILE2 / 256];
    uint val[MM_TILE2 / 256];
    uint dg[MM_TILE2 / 256];
    for (int r = 0; r < MM_TILE2 / 256; r++) {
        const uint j = (uint)r * 256 + tid;
        if (j < nt) {
            key[r] = kin[base + j];
            val[r] = A.vin[base + j];
            dg[r] = (uint)((key[r] >> A.shift) & 255);
            atomic_fetch_add_explicit(&h[dg[r]], 1u, memory_order_relaxed);
        } else dg[r] = 256u;
    }
    threadgroup_barrier(mem_flags::mem_threadgroup);
    const uint mine = atomic_load_explicit(&h[tid], memory_order_relaxed);
    const uint pre = simd_prefix_exclusive_sum(mine);
    threadgroup uint* part = lstart;                           // (8 partial sums, before lstart is written)
    threadgroup_barrier(mem_flags::mem_threadgroup);
    if (lane == 31) part[sg] = pre + mine;
    threadgroup_barrier(mem_flags::mem_threadgroup);
    uint ofs = pre;
    for (uint i = 0; i < sg; i++) ofs += part[i];
    threadgroup_barrier(mem_flags::mem_threadgroup);
    lstart[tid] = ofs;
    off[tid] = A.hist[(ulong)tid * A.ntiles + bid];
    run[tid] = ofs;
    threadgroup_barrier(mem_flags::mem_threadgroup);
    // local positions, stable: rounds in order, ranks inside a round from ballots, SIMD groups in order
    const ulong below_mask = (1ul << lane) - 1ul;
    uint lp[MM_TILE2 / 256];
    for (int r = 0; r < MM_TILE2 / 256; r++) {
        const uint d = dg[r];
        ulong peers = 0xFFFFFFFFul;
        for (int b = 0; b < 9; b++) {
            const bool set = ((d >> b) & 1u) != 0;
            const ulong vote = (ulong)(simd_vote::vote_t)simd_ballot(set);
            peers &= set ? vote : ~vote;
        }
        peers &= 0xFFFFFFFFul;
        const uint below = popcount(peers & below_mask);
        for (uint j = tid; j < 8 * 256; j += 256) cnt[j] = 0;
        threadgroup_barrier(mem_flags::mem_threadgroup);
        if (d < 256u && below == 0) cnt[sg * 256 + d] = (ushort)popcount(peers);
        threadgroup_barrier(mem_flags::mem_threadgroup);
        {
            uint rr = run[tid];
            for (uint s2 = 0; s2 < 8; s2++) {
                const uint c = cnt[s2 * 256 + tid];
                cnt[s2 * 256 + tid] = (ushort)(rr - lstart[tid]);
                rr += c;
            }
            run[tid] = rr;
        }
        threadgroup_barrier(mem_flags::mem_threadgroup);
        lp[r] = d < 256u ? lstart[d] + (uint)cnt[sg * 256 + d] + below : 0u;
        threadgroup_barrier(mem_flags::mem_threadgroup);
    }
    // keys through threadgroup memory, then out in runs
    for (int r = 0; r < MM_TILE2 / 256; r++) if (dg[r] < 256u) { buf[lp[r]] = key[r]; dbuf[lp[r]] = (uchar)dg[r]; }
    threadgroup_barrier(mem_flags::mem_threadgroup);
    for (uint j = tid; j < nt; j += 256) { const uint d = dbuf[j]; kout[off[d] + j - lstart[d]] = buf[j]; }
    threadgroup_barrier(mem_flags::mem_threadgroup);
    threadgroup uint* vbuf = (threadgroup uint*)buf;
    for (int r = 0; r < MM_TILE2 / 256; r++) if (dg[r] < 256u) vbuf[lp[r]] = val[r];
    threadgroup_barrier(mem_flags::mem_threadgroup);
    for (uint j = tid; j < nt; j += 256) { const uint d = dbuf[j]; A.vout[off[d] + j - lstart[d]] = vbuf[j]; }
}

kernel void k_rs_scatter2_64(constant SortArgs& A [[buffer(0)]], uint tid [[thread_position_in_threadgroup]],
                             uint bid [[threadgroup_position_in_grid]], uint lane [[thread_index_in_simdgroup]],
                             uint sg [[simdgroup_index_in_threadgroup]])
{
    threadgroup ulong buf[MM_TILE2];
    threadgroup uchar dbuf[MM_TILE2];
    threadgroup uint lstart[256], off[256], run[256];
    threadgroup ushort cnt[8 * 256];
    threadgroup atomic_uint h[256];
    rs_scatter2<ulong>(A, tid, bid, lane, sg, buf, dbuf, lstart, off, run, cnt, h);
}

kernel void k_rs_scatter2_32(constant SortArgs& A [[buffer(0)]], uint tid [[thread_position_in_threadgroup]],
                             uint bid [[threadgroup_position_in_grid]], uint lane [[thread_index_in_simdgroup]],
                             uint sg [[simdgroup_index_in_threadgroup]])
{
    threadgroup uint buf[MM_TILE2];
    threadgroup uchar dbuf[MM_TILE2];
    threadgroup uint lstart[256], off[256], run[256];
    threadgroup ushort cnt[8 * 256];
    threadgroup atomic_uint h[256];
    rs_scatter2<uint>(A, tid, bid, lane, sg, buf, dbuf, lstart, off, run, cnt, h);
}

template <typename KT>
static inline void rs_hist2(constant SortArgs& A, uint tid, uint bid, threadgroup atomic_uint* h)
{
    atomic_store_explicit(&h[tid], 0u, memory_order_relaxed);
    threadgroup_barrier(mem_flags::mem_threadgroup);
    device const KT* k = (device const KT*)A.kin;
    const ulong base = (ulong)bid * MM_TILE2;
    for (int r = 0; r < MM_TILE2 / 256; r++) {
        const ulong i = base + (ulong)r * 256 + tid;
        if (i < A.n) atomic_fetch_add_explicit(&h[(uint)((k[i] >> A.shift) & 255)], 1u, memory_order_relaxed);
    }
    threadgroup_barrier(mem_flags::mem_threadgroup);
    A.hist[(ulong)tid * A.ntiles + bid] = atomic_load_explicit(&h[tid], memory_order_relaxed);
}

kernel void k_rs_hist2_64(constant SortArgs& A [[buffer(0)]], uint tid [[thread_position_in_threadgroup]],
                          uint bid [[threadgroup_position_in_grid]])
{
    threadgroup atomic_uint h[256];
    rs_hist2<ulong>(A, tid, bid, h);
}

kernel void k_rs_hist2_32(constant SortArgs& A [[buffer(0)]], uint tid [[thread_position_in_threadgroup]],
                          uint bid [[threadgroup_position_in_grid]])
{
    threadgroup atomic_uint h[256];
    rs_hist2<uint>(A, tid, bid, h);
}

// ------------------------------------------------------------------------------------------------ prefix sums

kernel void k_scan_up(constant ScanArgs& A [[buffer(0)]], uint tid [[thread_position_in_threadgroup]],
                      uint bid [[threadgroup_position_in_grid]], uint lane [[thread_index_in_simdgroup]],
                      uint sg [[simdgroup_index_in_threadgroup]])
{
    threadgroup uint part[8];
    const ulong base = (ulong)bid * MM_SCANB + (ulong)tid * 8;
    uint s = 0;
    for (int i = 0; i < 8; i++) { const ulong j = base + i; if (j < A.n) s += A.in[j]; }
    s = simd_sum(s);
    if (lane == 0) part[sg] = s;
    threadgroup_barrier(mem_flags::mem_threadgroup);
    if (tid == 0) {
        uint t = 0;
        for (int i = 0; i < 8; i++) t += part[i];
        A.sums[bid] = t;
    }
}

// out = exclusive prefix within the block + the block's prefix (sums, already scanned; sums == 0: a single block)
kernel void k_scan_down(constant ScanArgs& A [[buffer(0)]], uint tid [[thread_position_in_threadgroup]],
                        uint bid [[threadgroup_position_in_grid]], uint lane [[thread_index_in_simdgroup]],
                        uint sg [[simdgroup_index_in_threadgroup]])
{
    threadgroup uint part[8];
    const ulong base = (ulong)bid * MM_SCANB + (ulong)tid * 8;
    uint v[8];
    uint s = 0;
    for (int i = 0; i < 8; i++) { const ulong j = base + i; v[i] = j < A.n ? A.in[j] : 0u; s += v[i]; }
    const uint pre = simd_prefix_exclusive_sum(s);
    if (lane == 31) part[sg] = pre + s;
    threadgroup_barrier(mem_flags::mem_threadgroup);
    uint off = A.nblocks > 1 ? A.sums[bid] : 0u;
    for (uint i = 0; i < sg; i++) off += part[i];
    off += pre;
    for (int i = 0; i < 8; i++) {
        const ulong j = base + i;
        if (j < A.n) A.out[j] = off;
        off += v[i];
    }
    if (bid == A.nblocks - 1 && tid == 255) *A.total = off;
}

// ------------------------------------------------------------------------------------------------ right tables

kernel void k_flag_head(constant DedupRArgs& A [[buffer(0)]], uint gid [[thread_position_in_grid]])
{
    if (gid >= A.n) return;
    A.flag[gid] = (gid == 0 || A.K[gid] != A.K[gid - 1]) ? 1u : 0u;
}

// after the scan of the head flags: every run of equal keys -> (key, lowest rank) at its position. Two kernels (some
// values have millions of codes, so no thread walks a run): the head of a run writes the key and an empty rank, then
// every entry lowers the rank atomically (one atomic per SIMD group when the group lies inside one run)
kernel void k_dedup_r(constant DedupRArgs& A [[buffer(0)]], uint gid [[thread_position_in_grid]])
{
    if (gid >= A.n) return;
    const ulong k = A.K[gid];
    if (gid > 0 && A.K[gid - 1] == k) return;
    const uint pos = A.flag[gid];
    A.Ko[pos] = k;
    A.Ro[pos] = MM_NONE;
}

kernel void k_dedup_r_min(constant DedupRArgs& A [[buffer(0)]], uint gid [[thread_position_in_grid]],
                          uint lane [[thread_index_in_simdgroup]])
{
    const bool in = gid < A.n;
    uint o = MM_NONE, r = MM_NONE;
    if (in) {
        const bool head = gid == 0 || A.K[gid - 1] != A.K[gid];
        o = head ? A.flag[gid] : A.flag[gid] - 1;              // exclusive scan of the heads: the run's position
        r = A.R[gid];
    }
    device atomic_uint* ro = (device atomic_uint*)A.Ro;
    const uint o0 = simd_broadcast_first(o);
    if (simd_all(in && o == o0)) {
        const uint m = simd_min(r);
        if (lane == 0) atomic_fetch_min_explicit(ro + o0, m, memory_order_relaxed);
    } else if (in) atomic_fetch_min_explicit(ro + o, r, memory_order_relaxed);
}

kernel void k_split_flag(constant SplitArgs& A [[buffer(0)]], uint gid [[thread_position_in_grid]])
{
    if (gid >= A.n) return;
    const ulong r = A.R[gid];
    A.flag[gid] = (r >= A.lo && r < A.hi) ? 1u : 0u;
}

kernel void k_split_scatter(constant SplitArgs& A [[buffer(0)]], uint gid [[thread_position_in_grid]])
{
    if (gid >= A.n) return;
    const ulong r = A.R[gid];
    if (!(r >= A.lo && r < A.hi)) return;
    const uint pos = A.flag[gid];
    A.Ko[pos] = A.K[gid];
    A.Ro[pos] = (uint)r;
}

// mitm_cr's error bound of every right side (eval_full: the same propagation, with float partials at the df64 values),
// relative to the value, in one byte (MM_EQ_DECODE); for the noise check of the closest pairs
kernel void k_r_err(constant RErrArgs& A [[buffer(0)]], constant GGram& g [[buffer(1)]],
                    uint gid [[thread_position_in_grid]])
{
    if (gid >= A.n) return;
    const ulong rank = A.R[gid];
    uint lo = 0, hi = (uint)A.nforms;
    while (hi - lo > 1) { const uint m = (lo + hi) >> 1; if (A.offs[m] <= rank) lo = m; else hi = m; }
    device const GForm* F = A.forms + lo;
    uchar dig[MM_RK];
    decode(F, rank - F->offset, dig);
    df64 val[MM_RK];
    float ec[MM_RK];
    for (int i = 0; i < F->K; i++) {
        const int dg = dig[i];
        df64 r;
        float e;
        if (F->ar[i] == 0) {
            r = g.cval[dg];
            e = r.lo == 0.0f && floor(r.hi) == r.hi ? 0.0f : 0.5f * MM_EPS * fabs(r.hi);
        } else if (F->ar[i] == 1) {
            const df64 a = val[i - 1];
            const int op = g.uop[dg];
            r = dfo_un(op, a);
            const float pa = dfo_p_un(op, a.hi, r.hi);
            e = prop(pa, ec[i - 1]) + w_cpu_un(op) * MM_EPS * fabs(r.hi);
            if (op == DU_SINPI || op == DU_COSPI || op == DU_TANPI) e += MM_EPS * fabs(a.hi * pa);
        } else {
            const int c1 = F->c1[i], c2 = F->c2[i];
            const df64 t = val[c1], s = val[c2];
            const int op = g.bop[dg];
            r = dfo_bin(op, t, s);
            const dfo_pp pp = dfo_p_bin(op, t.hi, s.hi, r.hi);
            e = prop(pp.t, ec[c1]) + prop(pp.s, ec[c2]) + w_cpu_bin(op) * MM_EPS * fabs(r.hi);
            if (cpu_bound_nan(op, t, ec[c2])) e = df_inf();
        }
        val[i] = r;
        ec[i] = e;
    }
    const float rel = ec[F->K - 1] / (MM_EPS * fabs(val[F->K - 1].hi));
    uchar q = 0;
    if (rel > 0.0f) q = !isfinite(rel) ? 255 : (uchar)clamp(1.0f + ceil(4.0f * log2(rel)), 1.0f, 255.0f);
    A.out[A.idx[gid]] = q;
}

// ------------------------------------------------------------------------------------------------ left sides

kernel void k_gen_l(constant LGenArgs& A [[buffer(0)]], constant GGram& g [[buffer(1)]],
                    uint gid [[thread_position_in_grid]])
{
    const ulong flat = A.F0 + gid;
    uchar dig[MM_LK];
    df64 val[MM_LK], der[MM_LK];
    float err[MM_LK], ecd[MM_LK];                              // df64 error bound; mitm_cr's double-precision bound
    int bad = 0, n = 0;
    device const GForm* F = A.forms + A.f0;
    ulong r0 = 0, ti = A.ti0;
    df64 T = df_f(0.0f);
    float tres = 0.0f, absT = 1.0f, kminT = 0.0f;
    if (flat < A.F1) {
        ti = flat / A.upt;
        const ulong u = flat - ti * A.upt;
        const uint fi = find_le(A.uoff, (uint)A.nf, u);
        F = A.forms + A.f0 + (int)fi;
        r0 = (u - A.uoff[fi]) * (ulong)A.usz[fi];
        const ulong left = F->count - r0;
        n = (int)(left < (ulong)A.usz[fi] ? left : (ulong)A.usz[fi]);
        decode(F, r0, dig);
        const uint t = A.act[ti];
        T = A.Tdf[t];
        tres = A.Tres[t];
        absT = T.hi != 0.0f ? fabs(T.hi) : 1.0f;
        kminT = (A.bench != 0 || T.hi == 0.0f) ? 0.0f : A.kmin * absT;
    }
    const uint tg = (uint)(ti - A.ti0);
    const float pmax = A.bench != 0 ? 0.0f : A.pmax;
    const bool want_der = A.want_der != 0;
    uint nl = 0, nk = 0;
    for (int st = 0; simd_any(st < n); st++) {
        bool has = false;
        df64 v = df_f(0.0f), d = df_f(0.0f);
        float e = 0.0f, ecr = 0.0f;
        if (st < n) {
            const int p = st != 0 ? odo_step(dig, F) : 0;
            if (p <= bad) {
                int i = p;
                for (; i < F->K; i++) {
                    const int dg = dig[i];
                    df64 r, dr = df_f(0.0f);
                    float er, ec;
                    bool dep = false;                          // the node depends on x through its inputs
                    if (F->ar[i] == 0) {
                        if (i == F->xpos || dg == g.nc) { r = T; dr = df_f(1.0f); er = 0.0f; ec = 0.0f; }
                        else {
                            r = g.cval[dg];
                            er = g.cerr[dg];
                            ec = r.lo == 0.0f && floor(r.hi) == r.hi ? 0.0f : 0.5f * MM_EPS * fabs(r.hi);
                        }
                    } else if (F->ar[i] == 1) {
                        const df64 a = val[i - 1];
                        const int op = g.uop[dg];
                        dep = der[i - 1].hi != 0.0f;
                        if (pmax > 0.0f && periodic(op) && dep && abs_gt(a, pmax)) break;
                        r = dfo_un(op, a);
                        if (want_der && F->dual[i] != 0 && dep) dr = df_mul(dfo_dun(op, a, r), der[i - 1]);
                        const float pa = dfo_p_un(op, a.hi, r.hi);
                        er = prop(pa, err[i - 1]) + dfo_w_un(op) * DFO_U * fabs(r.hi);
                        ec = prop(pa, ecd[i - 1]) + w_cpu_un(op) * MM_EPS * fabs(r.hi);
                        if (op == DU_SINPI || op == DU_COSPI || op == DU_TANPI) ec += MM_EPS * fabs(a.hi * pa);
                    } else {
                        const int c1 = F->c1[i], c2 = F->c2[i];
                        const df64 t = val[c1], s = val[c2];
                        const int op = g.bop[dg];
                        dep = der[c1].hi != 0.0f || der[c2].hi != 0.0f;
                        r = dfo_bin(op, t, s);
                        if (want_der && F->dual[i] != 0) dr = dfo_dbin(op, t, s, r, der[c1], der[c2]);
                        const dfo_pp pp = dfo_p_bin(op, t.hi, s.hi, r.hi);
                        er = prop(pp.t, err[c1]) + prop(pp.s, err[c2]) + dfo_w_bin(op, r.hi) * DFO_U * fabs(r.hi);
                        ec = prop(pp.t, ecd[c1]) + prop(pp.s, ecd[c2]) + w_cpu_bin(op) * MM_EPS * fabs(r.hi);
                        if (cpu_bound_nan(op, t, ecd[c2])) ec = df_inf();
                    }
                    // enum_L's guards: usable values, no zero derivative on the path of x, kappa >= kappa_min at
                    // every node that depends on x
                    if (!dfo_usable(r) || !dfo_usable(dr) || (want_der && dr.hi == 0.0f && dep)) break;
                    if (F->ar[i] != 0 && dr.hi != 0.0f && fabs(r.hi) / fabs(dr.hi) < kminT) break;
                    val[i] = r;
                    der[i] = dr;
                    err[i] = er;
                    ecd[i] = ec;
                }
                bad = i;
                has = i == F->K;
            }
            if (has) {
                v = val[F->K - 1];
                d = der[F->K - 1];
                e = err[F->K - 1];
                ecr = ecd[F->K - 1];
                if (A.bench != 0) has = v.hi != 0.0f;
                else if (d.hi == 0.0f) has = false;
                else {
                    nl++;
                    v = df_add(v, df_two_prod(d.hi, tres));    // L(T) = L(Tdf) + L'(T) (T - Tdf)
                    const float kap = fabs(v.hi) / fabs(d.hi) / absT;
                    if (!(kap >= A.kmin && kap <= A.kmax)) { nk++; has = false; }
                    // mitm_cr's error bound of L alone beyond errcap (twice: the partials are floats here): every
                    // candidate of this left value would be rejected; marked by a negative E (closest pairs only)
                    if (ecd[F->K - 1] / fabs(d.hi) / absT > 2.0f * A.errcap) e = -e - 1e-30f;
                }
            }
        }
        const uint pos = simd_append(has, A.cnt);
        if (has && pos < A.cap) {
            A.V[pos] = v;
            A.D[pos] = d;
            A.E[pos] = e;
            A.EC[pos] = ecr;
            A.LR[pos] = F->offset + r0 + (ulong)st;
            A.TG[pos] = tg;
        }
    }
    simd_count(nl, A.cnt + 1);
    simd_count(nk, A.cnt + 2);
}

kernel void k_lkeys(constant LSortArgs& A [[buffer(0)]], uint gid [[thread_position_in_grid]])
{
    if (gid >= A.n) return;
    A.K[gid] = df_key(A.V[gid]);
    A.I[gid] = gid;
}

kernel void k_gather_tg(constant LSortArgs& A [[buffer(0)]], uint gid [[thread_position_in_grid]])
{
    if (gid >= A.n) return;
    A.G[gid] = A.TG[A.I[gid]];
    A.P[gid] = gid;
}

// sorted by value (K, I), then stably by target (G, with P = the position in the value order; bytg = 0: one target):
// the first entry of every run of equal (target, value) selects the run's lowest rank, the others are dropped
kernel void k_dedup_l(constant LSortArgs& A [[buffer(0)]], uint gid [[thread_position_in_grid]])
{
    if (gid >= A.n) return;
    const bool bt = A.bytg != 0;
    const ulong p = bt ? A.P[gid] : gid;
    const uint t = bt ? A.G[gid] : 0u;
    const ulong k = A.K[p];
    if (gid > 0 && (bt ? A.G[gid - 1] : 0u) == t && A.K[bt ? A.P[gid - 1] : gid - 1] == k) {
        A.sel[gid] = MM_NONE;
        A.flag[gid] = 0u;
        return;
    }
    uint best = A.I[p];
    ulong br = 0;
    bool first = true;
    for (ulong j = gid + 1; j < A.n; j++) {
        if ((bt ? A.G[j] : 0u) != t) break;
        const ulong pj = bt ? A.P[j] : j;
        if (A.K[pj] != k) break;
        if (first) { br = A.LR[best]; first = false; }
        const uint e1 = A.I[pj];
        if (A.LR[e1] < br) { br = A.LR[e1]; best = e1; }
    }
    A.sel[gid] = best;
    A.flag[gid] = 1u;
}

kernel void k_compact_sel(constant LSortArgs& A [[buffer(0)]], uint gid [[thread_position_in_grid]])
{
    if (gid >= A.n) return;
    const uint s = A.sel[gid];
    if (s != MM_NONE) A.uniq[A.flag[gid]] = s;
}

// ------------------------------------------------------------------------------------------------ matching

static inline ulong lower_key(device const ulong* R, ulong n, ulong x)   // first i with R[i] >= x (n if none)
{
    ulong lo = 0, hi = n;
    while (lo < hi) {
        const ulong m = (lo + hi) >> 1;
        if (R[m] < x) lo = m + 1; else hi = m;
    }
    return lo;
}

static inline float df_dist(df64 a, df64 b)                    // a - b as a float (accurate when small)
{
    const df64 d = df_sub(a, b);
    return d.hi + d.lo;
}

static inline float r_err(ulong key, uchar q)                  // mitm_cr's error bound of a right side (absolute)
{
    return MM_EQ_DECODE(q) * MM_EPS * fabs(dfo_unord((uint)(key >> 32)));
}

#define MM_NEAR 4                                              // closest pairs kept per (left value, length)

struct Walk {                                                   // the state of one (left value, right length)
    float dmin[MM_NEAR];                                       // the closest |L - R_double| seen, ascending, with the
    uint rmin[MM_NEAR];                                        // ranks and error bounds (mitm_cr's) of the right sides
    float emin[MM_NEAR];
    int tries;
    bool any, stop;
};

static inline void walk_near(thread Walk& s, float d, uint r, float e)   // keep the MM_NEAR closest
{
    if (!(d < s.dmin[MM_NEAR - 1])) return;
    int i = MM_NEAR - 1;
    while (i > 0 && s.dmin[i - 1] > d) { s.dmin[i] = s.dmin[i - 1]; s.rmin[i] = s.rmin[i - 1]; s.emin[i] = s.emin[i - 1]; i--; }
    s.dmin[i] = d; s.rmin[i] = r; s.emin[i] = e;
}

// The right sides of one table (sorted by df64 value; double value = df64 value + C) near v, closest first by df64
// distance, as far as `walk`: those with |v - R_double| <= W become candidates (at most cand_max per left value and
// length). Entries with C = NaN are not usable in double or duplicates of a double value.
static inline void walk_table(constant MatchArgs& A, device const ulong* R, device const float* C, device const uint* RR,
                              device const uchar* RE, ulong n, df64 v, ulong key, float W, float walk, bool noisy, uint t,
                              ulong k, ulong lr, int b, thread Walk& s)
{
    if (n == 0 || s.stop) return;
    const ulong p = lower_key(R, n, key);
    ulong l = p, r = p;                                        // next: l - 1 (below), r (above)
    bool visited_l = false, visited_r = false;
    for (;;) {
        const float ul = l > 0 ? df_dist(v, df_unkey(R[l - 1])) : df_inf();
        const float ur = r < n ? df_dist(df_unkey(R[r]), v) : df_inf();
        const bool hl = ul <= walk, hr = ur <= walk;
        if (!hl && !hr) break;
        const bool below = hl && (!hr || ul <= ur);
        const ulong j = below ? --l : r++;
        if (below) visited_l = true; else visited_r = true;
        const float c = C[j];
        if (isnan(c)) continue;
        const float dc = fabs((below ? ul : -ur) - c);         // |L - R_double|
        if (dc < s.dmin[MM_NEAR - 1]) walk_near(s, dc, RR[j], r_err(R[j], RE[j]));
        if (dc > W) continue;
        s.any = true;
        if (noisy) { s.stop = true; return; }                  // mitm_cr: candidates, all rejected; no closest pair
        const uint pos = atomic_fetch_add_explicit(A.cnt, 1u, memory_order_relaxed);
        if (pos < A.cand_cap) {
            device CandRec& o = A.cand[pos];
            o.lrank = lr; o.rrank = RR[j]; o.t = t; o.k = (uint)k; o.b = b;
        }
        if (++s.tries >= A.cand_max) { atomic_fetch_add_explicit(A.cnt + 2, 1u, memory_order_relaxed); s.stop = true; return; }
    }
    // the neighbours of v, for the closest pair, if the walk did not reach them
    for (int side = 0; side < 2; side++) {
        if (side == 0 ? (visited_l || p == 0) : (visited_r || p >= n)) continue;
        const ulong j = side == 0 ? p - 1 : p;
        const float c = C[j];
        if (isnan(c)) continue;
        const float dc = fabs(df_dist(v, df_unkey(R[j])) - c);
        if (dc < s.dmin[MM_NEAR - 1]) walk_near(s, dc, RR[j], r_err(R[j], RE[j]));
    }
}

// ---- --verify gpu: what a GPU without double precision (WebGPU) decides alone

// value, derivative and df64 error bound of the code of a rank at x (the forms sorted by offset)
static inline void eval_code(device const GForm* forms, device const ulong* offs, int nforms, ulong rank,
                             constant GGram& g, df64 x, thread df64& v, thread df64& dv, thread float& err)
{
    uint lo = 0, hi = (uint)nforms;
    while (hi - lo > 1) { const uint m = (lo + hi) >> 1; if (offs[m] <= rank) lo = m; else hi = m; }
    device const GForm* F = forms + lo;
    uchar dig[MM_EK];
    decode(F, rank - F->offset, dig);
    df64 val[MM_EK], der[MM_EK];
    float e[MM_EK];
    for (int i = 0; i < F->K; i++) {
        const int dg = dig[i];
        df64 r, dr = df_f(0.0f);
        float er;
        if (F->ar[i] == 0) {
            if (i == F->xpos || dg == g.nc) { r = x; dr = df_f(1.0f); er = 0.0f; }
            else { r = g.cval[dg]; er = g.cerr[dg]; }
        } else if (F->ar[i] == 1) {
            const df64 a = val[i - 1];
            const int op = g.uop[dg];
            r = dfo_un(op, a);
            if (der[i - 1].hi != 0.0f) dr = df_mul(dfo_dun(op, a, r), der[i - 1]);
            er = prop(dfo_p_un(op, a.hi, r.hi), e[i - 1]) + dfo_w_un(op) * DFO_U * fabs(r.hi);
        } else {
            const int c1 = F->c1[i], c2 = F->c2[i];
            const df64 t = val[c1], s = val[c2];
            const int op = g.bop[dg];
            r = dfo_bin(op, t, s);
            if (der[c1].hi != 0.0f || der[c2].hi != 0.0f) dr = dfo_dbin(op, t, s, r, der[c1], der[c2]);
            const dfo_pp pp = dfo_p_bin(op, t.hi, s.hi, r.hi);
            er = prop(pp.t, e[c1]) + prop(pp.s, e[c2]) + dfo_w_bin(op, r.hi) * DFO_U * fabs(r.hi);
        }
        val[i] = r;
        der[i] = dr;
        e[i] = er;
    }
    v = val[F->K - 1];
    dv = der[F->K - 1];
    err = e[F->K - 1];
}

// mitm_cr's candidate() in df64: Newton steps from T on L(x) = R, the root within tolv, the error bounds of both
// sides mapped to x within errcap; true if accepted (recorded)
static inline bool verify_pair(constant MatchArgs& A, constant GGram& g, ulong lr, uint rr, df64 R, uint t, ulong k,
                               int a, int b, float absT)
{
    const df64 T = A.Tdf[t];
    const float tres = A.Tres[t];
    df64 x = T, v, dv;
    float eL = 0.0f, dL = 0.0f, eLi;
    for (int it = 0; it < 4; it++) {
        eval_code(A.Lf, A.Loff, A.nLf, lr, g, x, v, dv, eLi);
        if (it == 0) { eL = eLi; dL = dv.hi; }
        if (!dfo_usable(v) || !dfo_usable(dv) || dv.hi == 0.0f) return false;
        const df64 dx = df_div(df_sub(v, R), dv);
        if (dx.hi == 0.0f) break;
        x = df_sub(x, dx);
    }
    // the root's distance from T = Tdf + tres
    const float err = fabs(df_dist(x, T) - tres) / absT;
    df64 rv, rdv;
    float eR;
    eval_code(A.Rf, A.Roff, A.nRf, rr, g, df_f(0.0f), rv, rdv, eR);
    const float ex = (eL + eR) / fabs(dL) / absT;
    if (!(err <= A.tolv) || !(ex <= A.errcap)) return false;
    const uint pos = atomic_fetch_add_explicit(A.cnt + 3, 1u, memory_order_relaxed);
    if (pos < A.acc_cap) {
        device AccRec& o = A.acc[pos];
        o.lrank = lr; o.x = x; o.err = err; o.rrank = rr; o.t = t; o.k = (uint)k; o.b = b;
    }
    atomic_fetch_min_explicit(A.best + t, a + b, memory_order_relaxed);
    return true;
}

// one left value: the right lengths by increasing length, the df64 table only (no double values), closest first,
// at most maxtry candidates per length inside tolv |T| |L'|; the first accepted pair ends the left value
static inline void verify_left(constant MatchArgs& A, constant GGram& g, df64 v, float d, uint e, ulong lr, uint t,
                               ulong k, int a, int bmax, float absT)
{
    const float W = A.tolv * absT * d;
    const ulong key = df_key(v);
    for (int b = 1; b <= bmax; b++) {
        const ulong n = A.Rn[b];
        if (n == 0) continue;
        device const ulong* R = A.Rk[b];
        const ulong p = lower_key(R, n, key);
        ulong l = p, r = p;
        int tries = 0;
        while (tries < A.maxtry) {
            const float ul = l > 0 ? df_dist(v, df_unkey(R[l - 1])) : df_inf();
            const float ur = r < n ? df_dist(df_unkey(R[r]), v) : df_inf();
            const bool hl = ul <= W, hr = ur <= W;
            if (!hl && !hr) break;
            const ulong j = (hl && (!hr || ul <= ur)) ? --l : r++;
            tries++;
            atomic_fetch_add_explicit(A.cnt + 12, 1u, memory_order_relaxed);
            if (a + b > atomic_load_explicit(A.best + t, memory_order_relaxed)) continue;
            if (verify_pair(A, g, lr, A.Rr[b][j], df_unkey(R[j]), t, k, a, b, absT)) return;
        }
    }
    (void)e;
}

kernel void k_match(constant MatchArgs& A [[buffer(0)]], constant GGram& g [[buffer(1)]],
                    uint gid [[thread_position_in_grid]])
{
    const ulong k = A.k0 + gid;
    if (k >= A.k1) return;
    const uint e = A.uniq[k];
    const df64 v = A.V[e];
    const float d = fabs(A.D[e].hi), eE = A.E[e];
    const bool noisy = eE < 0.0f;                              // mitm_cr's errcap rejects all its candidates
    const float eL = noisy ? 0.0f : eE, ecl = A.EC[e];
    const ulong lr = A.LR[e];
    const uint t = A.act[A.ti0 + A.TG[e]];
    const float absT = A.absT[t];
    // the CPU's window tol |T| |L'| (computed here in float: 1e-4 wider), widened by the df64 error of L; the walk
    // in the main tables also visits right sides whose double value differs from their df64 value by up to cw u (the
    // others are in the side tables, sorted by their double value)
    const float w0 = A.tol * absT * d * 1.0001f;
    const float W = w0 + A.margin * eL;
    const float walk = W + A.cw * DFO_U * fabs(v.hi);
    const float walk_side = W + 4.0f * DFO_U * fabs(v.hi);
    if (A.stats != 0) {                                        // statistics: W / w0 in powers of 4 (cnt[4..11])
        const float q = W / w0;
        int bin = 0;
        for (float x = 4.0f; bin < 7 && q > x; x *= 4.0f) bin++;
        atomic_fetch_add_explicit(A.cnt + 4 + bin, 1u, memory_order_relaxed);
    }
    const int a = A.a;
    const bool want_apx = (A.all_apx != 0 || A.succ[t] == 0) && A.no_apx == 0;
    int bmax = A.KR;
    const int bt = atomic_load_explicit(A.best + t, memory_order_relaxed);
    if (bt != MM_INTMAX && bt - a < bmax) bmax = bt - a;
    const ulong key = df_key(v);
    for (int b = 1; b <= bmax; b++) {
        Walk s;
        for (int i = 0; i < MM_NEAR; i++) { s.dmin[i] = df_inf(); s.rmin[i] = 0; s.emin[i] = 0.0f; }
        s.tries = 0; s.any = false; s.stop = false;
        walk_table(A, A.Rk[b], A.Rc[b], A.Rr[b], A.Re[b], A.Rn[b], v, key, W, walk, noisy, t, k, lr, b, s);
        walk_table(A, A.Sk[b], A.Sc[b], A.Sr[b], A.Se[b], A.Sn[b], v, key, W, walk_side, noisy, t, k, lr, b, s);
        if (s.any || !want_apx || !(s.dmin[0] < df_inf())) continue;
        // no candidate: the closest pair is an approximation, if its rounding errors (mitm_cr's bounds), mapped to
        // x, are well below its distance (mitm_cr's noise check; the host checks again in double). Near ties are
        // recorded too: right sides within 2^-10 of the closest distance, and left values within 2^-12 of the
        // closest pair of the length so far (equivalent codes, x e^x and e^x x, differ in df64; the host decides in
        // double, in mitm_cr's order)
        device atomic_uint* slot = A.apx + (ulong)t * (ulong)A.NS + (ulong)(a + b);
        // Only a pair that surely passes the host's noise check (ratio <= 0.2 here, 0.25 there) lowers the slot; a
        // doubtful one (0.2-0.3) is recorded if it is close enough, but cannot hide a sure one: the result does not
        // depend on the order in which the threads arrive
        // The distances come from the df64 value of L, which is up to margin E off its double value: the slot holds
        // an upper bound of the true distance of a sure pair, and every pair whose lower bound reaches it is recorded,
        // so every pair that can be the closest in double is recorded, whatever the order of the threads
        const float de = A.margin * eL;
        for (int i = 0; i < MM_NEAR; i++) {
            if (!(s.dmin[i] <= s.dmin[0] * 1.001f + 2.0f * de)) break;
            const float ea = s.dmin[i] / d / absT;
            const float elo = fmax(0.0f, s.dmin[i] - de) / d / absT, ehi = (s.dmin[i] + de) / d / absT;
            const float noise = (ecl + s.emin[i]) / d / absT;
            if (!(noise <= 0.3f * ea)) continue;
            const bool sure = noise <= 0.2f * ea;
            if (elo > as_type<float>(atomic_load_explicit(slot, memory_order_relaxed)) * 1.000245f) continue;
            const uint old = sure ? atomic_fetch_min_explicit(slot, as_type<uint>(ehi), memory_order_relaxed)
                                  : atomic_load_explicit(slot, memory_order_relaxed);
            if (elo <= as_type<float>(old) * 1.000245f) {
                const uint pos = atomic_fetch_add_explicit(A.cnt + 1, 1u, memory_order_relaxed);
                if (pos < A.apx_cap) {
                    device ApxRec& o = A.apr[pos];
                    o.lrank = lr; o.rrank = s.rmin[i]; o.t = t; o.k = (uint)k; o.b = b; o.e = ea;
                }
            }
        }
    }
}

// --verify gpu: df64 alone, mitm_cr's rules (a kernel of its own: its full evaluation of codes would otherwise set the
// registers and the occupancy of k_match)
kernel void k_match_verify(constant MatchArgs& A [[buffer(0)]], constant GGram& g [[buffer(1)]],
                           uint gid [[thread_position_in_grid]])
{
    const ulong k = A.k0 + gid;
    if (k >= A.k1) return;
    const uint e = A.uniq[k];
    const df64 v = A.V[e];
    const float d = fabs(A.D[e].hi);
    const ulong lr = A.LR[e];
    const uint t = A.act[A.ti0 + A.TG[e]];
    const float absT = A.absT[t];
    const int a = A.a;
    int bmax = A.KR;
    const int bt = atomic_load_explicit(A.best + t, memory_order_relaxed);
    if (bt != MM_INTMAX && bt - a < bmax) bmax = bt - a;
    verify_left(A, g, v, d, e, lr, t, k, a, bmax, absT);
}

// --bench: pairs |L - R| <= tolrel |L| of every distinct left value with every table (by the df64 values)
kernel void k_bench_pairs(constant BenchArgs& A [[buffer(0)]], uint gid [[thread_position_in_grid]])
{
    if (gid >= A.n) return;
    const df64 v = df_unkey(A.keys[gid]);
    const df64 w = df_mul_f(df_abs(v), A.tolrel);
    const ulong lo_key = df_key(df_sub(v, w)), hi_key = df_key(df_add(v, w));
    uint c = 0;
    for (int b = 1; b <= A.KR; b++) {
        const ulong lo = lower_key(A.Rk[b], A.Rn[b], lo_key);
        ulong hi = lo;
        while (hi < A.Rn[b] && A.Rk[b][hi] <= hi_key) hi++;
        c += (uint)(hi - lo);
    }
    A.pairs[gid] = c;
}
