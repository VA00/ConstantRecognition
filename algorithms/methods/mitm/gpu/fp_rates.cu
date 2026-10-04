// fp_rates.cu - throughput of double and float arithmetic and library functions on the GPU (for the df64 question)
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// Consumer NVIDIA GPUs run FP64 at a small fraction of the FP32 rate. A double-float (df64) value costs about 10-20
// float operations per arithmetic operation, so whether df64 beats native double depends on that ratio. Every
// thread runs a dependent chain of N operations on its own value (no memory traffic); the result is summed so the
// compiler cannot drop the work.
// Build: nvcc -O3 -arch=sm_120 fp_rates.cu -o fp_rates   Usage: fp_rates
#include <cstdio>
#include <cuda_runtime.h>

static const int N = 4096;

template <class T, int OP>
__global__ void k(T* out, T seed)
{
    T x = seed + (T)(threadIdx.x + blockIdx.x * blockDim.x) * (T)1e-9;
    T acc = 0;
    for (int i = 0; i < N; i++) {
        if (OP == 0) x = fma(x, (T)0.999999, (T)1e-7);           // FMA
        else if (OP == 1) { x = exp(x) * (T)0.3; acc += x; }      // exp
        else if (OP == 2) { x = log(x + (T)2); acc += x; }        // log
        else if (OP == 3) { x = sin(x) + (T)0.5; acc += x; }      // sin
        else if (OP == 4) { x = (T)1 / (x + (T)3); acc += x; }    // division
        else if (OP == 5) { x = sqrt(x + (T)1); acc += x; }       // sqrt
    }
    out[blockIdx.x * blockDim.x + threadIdx.x] = x + acc;
}

template <class T, int OP>
static double run(const char* name)
{
    const int blocks = 84 * 32, threads = 256;
    T* d;
    cudaMalloc(&d, sizeof(T) * blocks * threads);
    k<T, OP><<<blocks, threads>>>(d, (T)0.5);                    // warm-up
    cudaEvent_t a, b;
    cudaEventCreate(&a);
    cudaEventCreate(&b);
    cudaEventRecord(a);
    k<T, OP><<<blocks, threads>>>(d, (T)0.5);
    cudaEventRecord(b);
    cudaEventSynchronize(b);
    float ms = 0;
    cudaEventElapsedTime(&ms, a, b);
    cudaFree(d);
    const double rate = (double)blocks * threads * N / (ms * 1e-3);
    printf("%-8s %-6s %8.1f G/s\n", name, sizeof(T) == 8 ? "double" : "float", rate / 1e9);
    return rate;
}

int main()
{
    cudaDeviceProp p;
    cudaGetDeviceProperties(&p, 0);
    printf("%s\n", p.name);
    const char* names[] = {"fma", "exp", "log", "sin", "1/x", "sqrt"};
    double r[6][2];
    r[0][0] = run<double, 0>(names[0]); r[0][1] = run<float, 0>(names[0]);
    r[1][0] = run<double, 1>(names[1]); r[1][1] = run<float, 1>(names[1]);
    r[2][0] = run<double, 2>(names[2]); r[2][1] = run<float, 2>(names[2]);
    r[3][0] = run<double, 3>(names[3]); r[3][1] = run<float, 3>(names[3]);
    r[4][0] = run<double, 4>(names[4]); r[4][1] = run<float, 4>(names[4]);
    r[5][0] = run<double, 5>(names[5]); r[5][1] = run<float, 5>(names[5]);
    printf("\nfloat / double throughput:\n");
    for (int i = 0; i < 6; i++) printf("%-8s %6.1f\n", names[i], r[i][1] / r[i][0]);
    return 0;
}
