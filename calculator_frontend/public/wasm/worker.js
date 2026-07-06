// Worker script: worker.js
//importScripts('rpn_function.js');
importScripts('vsearch.js');

let isReady = false;

// tell the main thread only when the runtime is ready
Module.onRuntimeInitialized = () => {
    isReady = true;
    postMessage({type: 'ready'});
};

function waitForReady() {
    return new Promise(resolve => {
        if (isReady) {
            resolve();
        } else {
            const check = setInterval(() => {
                if (isReady) {
                    clearInterval(check);
                    resolve();
                }
            }, 10);
        }
    });
}

function allocateDoubleArray(arr) {
    const ptr = Module._malloc(arr.length * 8);
    Module.HEAPF64.set(arr, ptr / 8);
    return ptr;
}

// Call a search function and free the returned JSON buffer.
// The C side malloc()s a ~1MB buffer per call and never frees it; with the
// task queue each worker makes dozens of calls per search and the WASM heap
// is fixed-size, so leaking the buffer would abort with OOM mid-search.
function callSearch(name, argTypes, args) {
    const toStr = (typeof UTF8ToString === 'function') ? UTF8ToString : Module.UTF8ToString;
    if (typeof toStr !== 'function') {
        // Cannot read via pointer; fall back to the leaky string path
        return JSON.parse(Module.ccall(name, 'string', argTypes, args));
    }
    const ptr = Module.ccall(name, 'number', argTypes, args);
    if (!ptr) return { results: [] };
    try {
        return JSON.parse(toStr(ptr));
    } finally {
        Module._free(ptr);
    }
}

function doWork(initDelay, z, inputValue, recognitionTarget, calculatorMode, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus, earlyExitCRThreshold, constList, funcList, opList) {
    return new Promise(resolve => {
        setTimeout(() => {
            try {
                // Restricted-instruction-set task (e.g. chain splitting: the
                // pure-unary chain structure tiled by 13 single-constant
                // calls). Lists must be complete — the C parser treats an
                // empty string as "zero ops", not "all".
                if (constList || funcList || opList) {
                    const result = callSearch('search_RPN_custom',
                        ['number', 'number', 'number', 'number', 'number', 'number', 'string', 'string', 'string'],
                        [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus,
                         constList || "", funcList || "", opList || ""]);
                    resolve(result);
                    return;
                }
                if (recognitionTarget === 'function') {
                    const pairs = inputValue.split(/[\n;]/).map(p => p.trim()).filter(p => p);
                    const x_arr = [];
                    const y_arr = [];
                    pairs.forEach(p => {
                        const parts = p.split(/[:,]/);
                        if (parts.length >= 2) {
                            x_arr.push(parseFloat(parts[0]));
                            y_arr.push(parseFloat(parts[1]));
                        }
                    });

                    if (x_arr.length > 0) {
                        const x_ptr = allocateDoubleArray(x_arr);
                        const y_ptr = allocateDoubleArray(y_arr);
                        const result = callSearch('search_function_wasm',
                            ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
                            [x_ptr, y_ptr, 0, x_arr.length, MinCodeLength, MaxCodeLength, cpuId, ncpus]);
                        Module._free(x_ptr);
                        Module._free(y_ptr);
                        resolve(result);
                        return;
                    }
                } else if (recognitionTarget === 'multiple') {
                    const vals = inputValue.split(/[,;\n]/).map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
                    if (vals.length > 0) {
                        const x_arr = new Array(vals.length).fill(0);
                        const x_ptr = allocateDoubleArray(x_arr);
                        const y_ptr = allocateDoubleArray(vals);
                        const result = callSearch('search_batch_wasm',
                            ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
                            [x_ptr, y_ptr, 0, vals.length, MinCodeLength, MaxCodeLength, cpuId, ncpus]);
                        Module._free(x_ptr);
                        Module._free(y_ptr);
                        resolve(result);
                        return;
                    }
                }

                if (calculatorMode === 'list' || calculatorMode === 'custom') {
                    // Can be extended to pass custom operator lists
                    const result = callSearch('search_RPN_custom',
                        ['number', 'number', 'number', 'number', 'number', 'number', 'string', 'string', 'string'],
                        [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus, "", "", ""]);
                    resolve(result);
                    return;
                }

                if (typeof Module._search_RPN_with_cr === 'function') {
                    const result = callSearch('search_RPN_with_cr',
                                   ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
                                   [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus, earlyExitCRThreshold]);
                    resolve(result);
                    return;
                }

                const result = callSearch('search_RPN',
                               ['number', 'number', 'number', 'number', 'number', 'number'],
                               [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus]);
                resolve(result);
            } catch (err) {
                console.error('WASM call error:', err);
                resolve({ results: [], error: err.message });
            }
        }, initDelay);
    });
}

onmessage = async function(e) {
    const {
        initDelay = 0,
        z,
        inputValue,
        recognitionTarget,
        calculatorMode,
        inputPrecision,
        MinCodeLength,
        MaxCodeLength,
        cpuId,
        ncpus,
        earlyExitCRThreshold = 0.9,
        workerId,
        constList,
        funcList,
        opList
    } = e.data;

    // Wait for WASM to be ready
    await waitForReady();

    // With the task queue a worker handles many small slices per search,
    // so per-task logging is kept quiet to avoid console spam.
    const resultJSON = await doWork(initDelay, z, inputValue, recognitionTarget, calculatorMode, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus, earlyExitCRThreshold, constList, funcList, opList);

    if (resultJSON.error) {
        console.error(`Worker ${workerId ?? cpuId} task error:`, resultJSON.error);
    }

    postMessage({
        cpuId,
        workerId,
        ...resultJSON
    });
};
