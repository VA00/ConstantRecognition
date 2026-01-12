// Worker script for function recognition: worker_function.js
importScripts('vsearch.js');

let runtimeReady = false;
const pendingMessages = [];

Module.onRuntimeInitialized = () => {
  runtimeReady = true;
  postMessage({ type: 'ready' });
  while (pendingMessages.length > 0) {
    const message = pendingMessages.shift();
    if (message) handleWork(message);
  }
};

function toByteArray(values) {
  return new Uint8Array(new Float64Array(values).buffer);
}

function doWork(initDelay, xValues, yValues, dyValues, MinCodeLength, MaxCodeLength, cpuId, ncpus) {
  return new Promise(resolve => {
    setTimeout(() => {
      const xBytes = toByteArray(xValues);
      const yBytes = toByteArray(yValues);
      const dyBytes = toByteArray(dyValues);

      const result = Module.ccall(
        'search_function_wasm',
        'string',
        ['array', 'array', 'array', 'number', 'number', 'number', 'number', 'number'],
        [
          xBytes,
          yBytes,
          dyBytes,
          xValues.length,
          MinCodeLength,
          MaxCodeLength,
          cpuId,
          ncpus
        ]
      );

      resolve(JSON.parse(result));
    }, initDelay);
  });
}

const handleWork = async (e) => {
  const { initDelay, xValues, yValues, dyValues, MinCodeLength, MaxCodeLength, cpuId, ncpus } = e.data;
  console.log(
    `Worker ${cpuId} of ${ncpus} starting function search with ${xValues.length} points, MinK=${MinCodeLength}, MaxK=${MaxCodeLength}`
  );

  const resultJSON = await doWork(initDelay, xValues, yValues, dyValues, MinCodeLength, MaxCodeLength, cpuId, ncpus);

  console.log(`Worker ${cpuId} finished work with result:`, resultJSON);

  postMessage({
    cpuId,
    ...resultJSON
  });
};

onmessage = (e) => {
  if (!runtimeReady) {
    pendingMessages.push(e);
    return;
  }
  handleWork(e);
};
