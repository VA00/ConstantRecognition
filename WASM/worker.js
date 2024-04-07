// Worker script: worker.js
importScripts('rpn_function.js');


function doWork(initDelay, z, MaxCodeLength, cpuid, ncpus) {
 
    return new Promise(resolve => {
        setTimeout(() => { //Timeout is required for Module to initialize
            
            const result = Module.ccall('search_RPN', 'string', ['number', 'number', 'number', 'number'], [z, MaxCodeLength, cpuid, ncpus]);
            
            resolve(result);
            
        }, initDelay);
    });
}


onmessage = async function(e) {
    const { initDelay, z, MaxCodeLength, cpuId, ncpus } = e.data;
    //console.log(`Worker (worker.js) ${cpuId} of ${ncpus} starting work for z=${z}, MaxCodeLength=${MaxCodeLength}`);
    const resultString = await doWork(initDelay, z, MaxCodeLength, cpuId, ncpus);
    //const resultArray = resultString.split(", ");
    const resultJSON = JSON.parse(resultString);
    //console.log(`Worker (worker.js) ${cpuId} finished work with result ${resultString}`);
    //console.log(resultArray[resultArray.length-1]);

    postMessage(resultJSON);
};
