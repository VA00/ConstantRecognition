// mitm_worker.js - the meet-in-the-middle search for the page app/mitm
//
// Loads mitm.js / mitm.wasm (algorithms/methods/mitm/mitm_wasm.cpp). One worker keeps the right-side table in its
// memory for the whole session: "build" makes the table for a button set, every "search" reuses it. The page
// loads this file as mitm_worker.js?v=<hash>; the query is forwarded to mitm.js and mitm.wasm (cache busting, as
// in worker.js).
//
// Messages in:  {type: 'build', id, consts, funcs, ops, kr, memcapGB}
//               {type: 'search', id, T, tolrel, kl, anyx, listCap}
// Messages out: {type: 'ready'} once, then {type: 'built' | 'result', id, ...JSON of the engine}
//               or {type: 'error', id, error}
var wasmQuery = (typeof self !== 'undefined' && self.location && self.location.search) ? self.location.search : '';
var Module = {
    locateFile: function(path, prefix) { return (prefix || '') + path + wasmQuery; }
};
importScripts('mitm.js' + wasmQuery);

var ready = false;
var pending = [];

Module.onRuntimeInitialized = function() {
    ready = true;
    postMessage({ type: 'ready' });
    pending.splice(0).forEach(handle);
};

// Call a C function returning a malloc()ed JSON string and free it
function call(name, argTypes, args) {
    var ptr = Module.ccall(name, 'number', argTypes, args);
    try {
        return JSON.parse(Module.UTF8ToString(ptr));
    } finally {
        Module._free(ptr);
    }
}

function handle(msg) {
    try {
        if (msg.type === 'build') {
            var t0 = performance.now();
            var b = call('mitm_build', ['string', 'string', 'string', 'number', 'number'],
                         [msg.consts, msg.funcs, msg.ops, msg.kr, msg.memcapGB || 1.5]);
            b.ms = performance.now() - t0;
            b.type = 'built';
            b.id = msg.id;
            postMessage(b);
        } else if (msg.type === 'search') {
            var r = call('mitm_search', ['number', 'number', 'number', 'number', 'number'],
                         [msg.T, msg.tolrel || 0, msg.kl, msg.anyx ? 1 : 0, msg.listCap || 0]);
            r.type = 'result';
            r.id = msg.id;
            postMessage(r);
        }
    } catch (err) {
        // e.g. out of memory: the module may be unusable afterwards, the page starts a new worker
        postMessage({ type: 'error', id: msg.id, error: String((err && err.message) || err) });
    }
}

onmessage = function(e) {
    if (ready) handle(e.data);
    else pending.push(e.data);
};
