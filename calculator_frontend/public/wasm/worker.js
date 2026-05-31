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

function doWork(initDelay, z, inputValue, recognitionTarget, calculatorMode, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus, earlyExitCRThreshold) {
    return new Promise(resolve => {
        setTimeout(() => {
            try {
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
                        const result = Module.ccall('search_function_wasm', 'string',
                            ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
                            [x_ptr, y_ptr, 0, x_arr.length, MinCodeLength, MaxCodeLength, cpuId, ncpus]);
                        Module._free(x_ptr);
                        Module._free(y_ptr);
                        resolve(JSON.parse(result));
                        return;
                    }
                } else if (recognitionTarget === 'multiple') {
                    const vals = inputValue.split(/[,;\n]/).map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
                    if (vals.length > 0) {
                        const x_arr = new Array(vals.length).fill(0);
                        const x_ptr = allocateDoubleArray(x_arr);
                        const y_ptr = allocateDoubleArray(vals);
                        const result = Module.ccall('search_batch_wasm', 'string',
                            ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
                            [x_ptr, y_ptr, 0, vals.length, MinCodeLength, MaxCodeLength, cpuId, ncpus]);
                        Module._free(x_ptr);
                        Module._free(y_ptr);
                        resolve(JSON.parse(result));
                        return;
                    }
                }
                
                if (calculatorMode === 'list' || calculatorMode === 'custom') {
                    // Can be extended to pass custom operator lists
                    const result = Module.ccall('search_RPN_custom', 'string',
                        ['number', 'number', 'number', 'number', 'number', 'number', 'string', 'string', 'string'],
                        [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus, "", "", ""]);
                    resolve(JSON.parse(result));
                    return;
                }

                if (typeof Module._search_RPN_with_cr === 'function') {
                    const result = Module.ccall('search_RPN_with_cr', 'string',
                                   ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
                                   [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus, earlyExitCRThreshold]);
                    resolve(JSON.parse(result));
                    return;
                }

                const result = Module.ccall('search_RPN', 'string',
                               ['number', 'number', 'number', 'number', 'number', 'number'],
                               [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus]);
                resolve(JSON.parse(result));
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
        earlyExitCRThreshold = 0.9
    } = e.data;
    
    // Wait for WASM to be ready
    await waitForReady();
    
    console.log(`Worker ${cpuId} of ${ncpus} starting work for z=${z}, Target=${recognitionTarget}, Mode=${calculatorMode}`);
    
    const resultJSON = await doWork(initDelay, z, inputValue, recognitionTarget, calculatorMode, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus, earlyExitCRThreshold);
    
    console.log(`Worker ${cpuId} finished work with result:`, resultJSON);
    
    postMessage({
        cpuId,
        ...resultJSON
    });
};
