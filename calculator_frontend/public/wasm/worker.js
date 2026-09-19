// Worker script: worker.js
//
// The page loads this file as worker.js?v=<hash>. The same query is forwarded
// to vsearch.js and vsearch.wasm so that all three are cache-busted together
// (static servers send no cache-control headers for them).
var wasmQuery = (typeof self !== 'undefined' && self.location && self.location.search) ? self.location.search : '';
var Module = {
    locateFile: function(path, prefix) { return (prefix || '') + path + wasmQuery; }
};
importScripts('vsearch.js' + wasmQuery);

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

// Call a C function returning a malloc()ed JSON string and free the buffer.
// The C side malloc()s a ~1MB buffer per search call and never frees it; with
// the task queue each worker makes dozens of calls per search and the WASM
// heap is fixed-size, so leaking the buffer would abort with OOM mid-search.
function callJSON(name, argTypes, args) {
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
        z, zIm, domain, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus,
        earlyExitCRThreshold, constList, funcList, opList
    } = task;
    try {
        // Complex domain: target z + i*zIm. Button lists are always explicit
        // here (the main thread fills them in for the full calculator too).
        if (domain === 'complex') {
            return callJSON('search_RPN_complex',
                ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'string', 'string', 'string', 'number'],
                [z, zIm || 0, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus,
                 constList || "", funcList || "", opList || "", earlyExitCRThreshold]);
        }

        // Restricted-instruction-set task: user-disabled palette buttons or
        // chain splitting (the pure-unary chain tiled by single-constant
        // calls). Lists are explicit; an empty string means "none of these",
        // matching the C parser's semantics.
        if (constList !== undefined || funcList !== undefined || opList !== undefined) {
            if (typeof Module._search_RPN_custom_cr === 'function') {
                return callJSON('search_RPN_custom_cr',
                    ['number', 'number', 'number', 'number', 'number', 'number', 'string', 'string', 'string', 'number'],
                    [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus,
                     constList || "", funcList || "", opList || "", earlyExitCRThreshold]);
            }
            return callJSON('search_RPN_custom',
                ['number', 'number', 'number', 'number', 'number', 'number', 'string', 'string', 'string'],
                [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus,
                 constList || "", funcList || "", opList || ""]);
        }

        if (typeof Module._search_RPN_with_cr === 'function') {
            return callJSON('search_RPN_with_cr',
                ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
                [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus, earlyExitCRThreshold]);
        }

        return callJSON('search_RPN',
            ['number', 'number', 'number', 'number', 'number', 'number'],
            [z, inputPrecision, MinCodeLength, MaxCodeLength, cpuId, ncpus]);
    } catch (err) {
        console.error('WASM call error:', err);
        return { results: [], error: err.message };
    }
}

// Evaluate a named RPN code in the complex domain using every button the
// engine knows (CALC4 plus I, GLAISHER, CATALAN, KHINCHIN, EULERGAMMA).
function doEvaluate(rpn) {
    try {
        return callJSON('evaluate_RPN_complex', ['string'], [rpn]);
    } catch (err) {
        return { ok: 0, error: err.message };
    }
}

onmessage = async function(e) {
    const msg = e.data;

    // Wait for WASM to be ready
    await waitForReady();

    if (msg && msg.type === 'evaluate') {
        postMessage({ type: 'evaluated', id: msg.id, rpn: msg.rpn, ...doEvaluate(msg.rpn) });
        return;
    }

    const task = { earlyExitCRThreshold: 0.9, ...msg };

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
