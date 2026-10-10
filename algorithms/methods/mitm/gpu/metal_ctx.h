// metal_ctx.h - the Metal device for the Phase 2 programs on the Mac: kernels compiled at run time from an embedded
// source, buffers in unified memory with a memory cap, and dispatches
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// Objective-C++ (clang++ -fobjc-arc), header only. Every buffer is shared between the CPU and the GPU (unified
// memory): the host reads the results in place, no transfers. Kernels receive one argument struct by value
// (setBytes, index 0) that holds the buffers' GPU addresses; every live buffer is made resident for every dispatch.
// Math: MTLMathModeSafe and precise library functions (no fast math: df64.h needs IEEE rounding of every float
// operation); df64.h itself adds "#pragma METAL fp contract(off)".
#ifndef METAL_CTX_H
#define METAL_CTX_H

#import <Metal/Metal.h>
#import <Foundation/Foundation.h>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <string>
#include <vector>
#include <map>
#include <unordered_map>
#include <chrono>

template <class T>
struct DArr {                                                  // a typed device array (shared storage)
    id<MTLBuffer> buf = nil;
    size_t n = 0;
    T* h() const { return (T*)buf.contents; }                  // host view
    uint64_t g() const { return buf ? buf.gpuAddress : 0; }    // GPU address, for the argument structs
    T& operator[](size_t i) const { return h()[i]; }
};

struct MetalCtx {
    id<MTLDevice> dev = nil;
    id<MTLCommandQueue> queue = nil;
    id<MTLLibrary> lib = nil;
    std::map<std::string, id<MTLComputePipelineState>> pipes;
    std::unordered_map<void*, id<MTLBuffer>> live;             // keyed by the buffer object
    std::vector<id<MTLResource>> resident;
    bool resident_dirty = true;
    size_t cur = 0, peak = 0;
    double cap = 0;                                            // memory cap of the program's buffers, bytes
    double gpu_seconds = 0;                                    // summed GPU time of the command buffers
    // a command buffer being recorded (batch of dispatches)
    id<MTLCommandBuffer> cb = nil;
    id<MTLComputeCommandEncoder> enc = nil;

    // compile the source; returns "" or an error message
    std::string init(const std::string& source)
    {
        dev = MTLCreateSystemDefaultDevice();
        if (!dev) return "no Metal device";
        queue = [dev newCommandQueue];
        MTLCompileOptions* o = [MTLCompileOptions new];
        if (@available(macOS 15.0, *)) {
            o.mathMode = MTLMathModeSafe;
            o.mathFloatingPointFunctions = MTLMathFloatingPointFunctionsPrecise;
        } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            o.fastMathEnabled = NO;
#pragma clang diagnostic pop
        }
        o.languageVersion = MTLLanguageVersion3_1;
        NSError* e = nil;
        lib = [dev newLibraryWithSource:[NSString stringWithUTF8String:source.c_str()] options:o error:&e];
        if (!lib) return std::string("Metal compile error: ") + (e ? e.localizedDescription.UTF8String : "?");
        return "";
    }

    std::string name() const { return dev ? std::string(dev.name.UTF8String) : std::string("-"); }
    double working_set() const { return dev ? (double)dev.recommendedMaxWorkingSetSize : 0.0; }

    id<MTLComputePipelineState> pipe(const char* fn)
    {
        auto it = pipes.find(fn);
        if (it != pipes.end()) return it->second;
        NSError* e = nil;
        id<MTLFunction> f = [lib newFunctionWithName:[NSString stringWithUTF8String:fn]];
        if (!f) { fprintf(stderr, "Metal: no kernel %s\n", fn); exit(4); }
        id<MTLComputePipelineState> p = [dev newComputePipelineStateWithFunction:f error:&e];
        if (!p) { fprintf(stderr, "Metal: pipeline %s: %s\n", fn, e ? e.localizedDescription.UTF8String : "?"); exit(4); }
        pipes[fn] = p;
        return p;
    }

    template <class T>
    DArr<T> alloc(size_t n, bool zero = false)
    {
        DArr<T> a;
        const size_t bytes = (n ? n : 1) * sizeof(T);
        if (bytes > dev.maxBufferLength) { fprintf(stderr, "Metal: buffer of %.2f GB exceeds maxBufferLength\n", bytes / 1073741824.0); exit(4); }
        a.buf = [dev newBufferWithLength:bytes options:MTLResourceStorageModeShared | MTLResourceHazardTrackingModeUntracked];
        if (!a.buf) { fprintf(stderr, "Metal: cannot allocate %.2f GB\n", bytes / 1073741824.0); exit(4); }
        a.n = n;
        if (zero) memset(a.buf.contents, 0, bytes);
        live[(__bridge void*)a.buf] = a.buf;
        cur += bytes;
        if (cur > peak) peak = cur;
        resident_dirty = true;
        return a;
    }

    template <class T>
    DArr<T> upload(const std::vector<T>& v)
    {
        DArr<T> a = alloc<T>(v.size());
        if (!v.empty()) memcpy(a.h(), v.data(), v.size() * sizeof(T));
        return a;
    }

    template <class T>
    void free(DArr<T>& a)
    {
        if (!a.buf) return;
        cur -= a.buf.length;
        live.erase((__bridge void*)a.buf);
        a.buf = nil;
        a.n = 0;
        resident_dirty = true;
    }

    // ---- dispatches: begin(), add(...) any number of times, end() waits for the GPU
    void begin()
    {
        if (cb) return;
        cb = [queue commandBuffer];
        enc = [cb computeCommandEncoder];                      // serial: each dispatch sees the previous one's writes
        if (resident_dirty) {
            resident.clear();
            for (auto& kv : live) resident.push_back(kv.second);
            resident_dirty = false;
        }
        if (!resident.empty())
            [enc useResources:resident.data() count:resident.size() usage:MTLResourceUsageRead | MTLResourceUsageWrite];
    }

    // buffers allocated after begin(): resident from the next dispatch on
    void refresh()
    {
        if (!resident_dirty || !enc) return;
        resident.clear();
        for (auto& kv : live) resident.push_back(kv.second);
        resident_dirty = false;
        if (!resident.empty())
            [enc useResources:resident.data() count:resident.size() usage:MTLResourceUsageRead | MTLResourceUsageWrite];
    }

    // n threads of the kernel fn (threadgroups of tg threads; the grid is rounded up, kernels test their range)
    // (args2: a second struct at index 1, e.g. the buttons)
    void add(const char* fn, uint64_t n, const void* args, size_t bytes, const void* args2 = nullptr, size_t bytes2 = 0,
             int tg = 256)
    {
        if (n == 0) return;
        if (!cb) begin();
        refresh();
        id<MTLComputePipelineState> p = pipe(fn);
        [enc setComputePipelineState:p];
        [enc setBytes:args length:bytes atIndex:0];
        if (args2) [enc setBytes:args2 length:bytes2 atIndex:1];
        const uint64_t groups = (n + tg - 1) / tg;
        [enc dispatchThreadgroups:MTLSizeMake((NSUInteger)groups, 1, 1) threadsPerThreadgroup:MTLSizeMake(tg, 1, 1)];
    }

    // threadgroups directly (kernels that work per threadgroup)
    void add_groups(const char* fn, uint64_t groups, const void* args, size_t bytes, int tg = 256)
    {
        if (groups == 0) return;
        if (!cb) begin();
        refresh();
        [enc setComputePipelineState:pipe(fn)];
        [enc setBytes:args length:bytes atIndex:0];
        [enc dispatchThreadgroups:MTLSizeMake((NSUInteger)groups, 1, 1) threadsPerThreadgroup:MTLSizeMake(tg, 1, 1)];
    }

    void end()
    {
        if (!cb) return;
        [enc endEncoding];
        [cb commit];
        [cb waitUntilCompleted];
        if (cb.status != MTLCommandBufferStatusCompleted) {
            fprintf(stderr, "Metal: command buffer failed: %s\n", cb.error ? cb.error.localizedDescription.UTF8String : "?");
            exit(4);
        }
        gpu_seconds += cb.GPUEndTime - cb.GPUStartTime;
        enc = nil;
        cb = nil;
    }

    // one dispatch, waited for
    void run(const char* fn, uint64_t n, const void* args, size_t bytes)
    {
        begin();
        add(fn, n, args, bytes);
        end();
    }
};

#endif
