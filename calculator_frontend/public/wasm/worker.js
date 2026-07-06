// Worker script: worker.js
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

function doWork(task) {
    const {
        z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus,
        earlyExitCRThreshold, constList, funcList, opList
    } = task;
    try {
        // Restricted-instruction-set task: user-disabled palette buttons or
        // chain splitting (the pure-unary chain tiled by single-constant
        // calls). Lists are explicit; an empty string means "none of these",
        // matching the C parser's semantics.
        if (constList !== undefined || funcList !== undefined || opList !== undefined) {
            return callSearch('search_RPN_custom',
                ['number', 'number', 'number', 'number', 'number', 'number', 'string', 'string', 'string'],
                [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus,
                 constList || "", funcList || "", opList || ""]);
        }

        if (typeof Module._search_RPN_with_cr === 'function') {
            return callSearch('search_RPN_with_cr',
                ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
                [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus, earlyExitCRThreshold]);
        }

        return callSearch('search_RPN',
            ['number', 'number', 'number', 'number', 'number', 'number'],
            [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus]);
    } catch (err) {
        console.error('WASM call error:', err);
        return { results: [], error: err.message };
    }
}

onmessage = async function(e) {
    const task = { earlyExitCRThreshold: 0.9, ...e.data };

    // Wait for WASM to be ready
    await waitForReady();

    // With the task queue a worker handles many small slices per search,
    // so per-task logging is kept quiet to avoid console spam.
    const resultJSON = doWork(task);

    if (resultJSON.error) {
        console.error(`Worker ${task.workerId ?? task.cpuId} task error:`, resultJSON.error);
    }

    postMessage({
        cpuId: task.cpuId,
        workerId: task.workerId,
        ...resultJSON
    });
};
