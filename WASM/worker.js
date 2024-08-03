// Worker script: worker.js
importScripts('rpn_function.js');

function doWork(initDelay, z, MaxCodeLength, cpuId, ncpus) {
    return new Promise(resolve => {
        setTimeout(() => {
            const result = Module.ccall('search_RPN', 'string', ['number', 'number', 'number', 'number'], [z, MaxCodeLength, cpuId, ncpus]);
            resolve(JSON.parse(result));
        }, initDelay);
    });
}

onmessage = async function(e) {
    const { initDelay, z, MaxCodeLength, cpuId, ncpus } = e.data;
    console.log(`Worker ${cpuId} of ${ncpus} starting work for z=${z}, MaxCodeLength=${MaxCodeLength}`);
    
    const resultJSON = await doWork(initDelay, z, MaxCodeLength, cpuId, ncpus);
    
    console.log(`Worker ${cpuId} finished work with result:`, resultJSON);
    
    postMessage({
        cpuId,
        ...resultJSON
    });
};