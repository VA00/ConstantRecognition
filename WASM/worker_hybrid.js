// Worker script for Hybrid FP32+FP64 search
// worker_hybrid.js
//
// Based on function2 architecture with ternary form + recursive expansion
//
// This worker uses the hybrid algorithm that:
// 1. For each ternary form, scans all combinations quickly with FP32 (float)
// 2. Collects "candidates" where FP32 error < threshold
// 3. Verifies only candidates with FP64 (double) for accurate results
//
// Expected speedup: 5-10x compared to pure FP64 search
// Prof. Odrzywolek achieved 128x speedup on GPU with similar approach

importScripts('rpn_function_hybrid.js');

// Tell the main thread when the runtime is ready
Module.onRuntimeInitialized = () => postMessage({type: 'ready', mode: 'hybrid_fp32_fp64'});

/**
 * Execute hybrid search
 * @param {number} initDelay - Initial delay before starting (ms)
 * @param {number} z - Target value to search for
 * @param {number} inputPrecision - Input precision (Delta_z)
 * @param {number} MinCodeLength - Minimum RPN code length
 * @param {number} MaxCodeLength - Maximum RPN code length  
 * @param {number} cpuId - Worker ID (0 to ncpus-1)
 * @param {number} ncpus - Total number of workers
 */
function doWork(initDelay, z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus) {
    return new Promise(resolve => {
        setTimeout(() => {
            const result = Module.ccall('search_RPN_hybrid', 'string', 
                           ['number', 'number', 'number', 'number', 'number', 'number'], 
                           [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus]);
            resolve(JSON.parse(result));
        }, initDelay);
    });
}

onmessage = async function(e) {
    const { 
        initDelay, 
        z, 
        inputPrecision, 
        MinCodeLength, 
        MaxCodeLength, 
        cpuId, 
        ncpus
    } = e.data;
    
    console.log(`Hybrid Worker ${cpuId}/${ncpus} starting:`, {
        target: z,
        precision: inputPrecision,
        codeLength: `${MinCodeLength}-${MaxCodeLength}`,
        mode: 'FP32 filter + FP64 verify'
    });
    
    const startTime = performance.now();
    
    const resultJSON = await doWork(
        initDelay, 
        z, 
        inputPrecision, 
        MinCodeLength, 
        MaxCodeLength, 
        cpuId, 
        ncpus
    );
    
    const elapsedMs = performance.now() - startTime;
    
    console.log(`Hybrid Worker ${cpuId} finished in ${elapsedMs.toFixed(0)}ms:`, {
        result: resultJSON.result,
        fp32_evals: resultJSON.fp32_evals,
        fp64_evals: resultJSON.fp64_evals,
        speedup: resultJSON.speedup_factor || 'N/A'
    });
    
    postMessage({
        cpuId,
        elapsedMs,
        ...resultJSON
    });
};
