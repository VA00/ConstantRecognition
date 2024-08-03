import * as Interpreter from './RPN_interpreter.js';
import * as Evaluator from './RPN_evaluator.js';
import * as Mma from './RPN_to_Mma_interpreter.js';

let Module;
let workers = [];

async function initializeModule() {
    Module = await window.moduleReadyPromise;
    console.log("Module initialized in main_parallel.js");
}

function updateSearchDepthValue(value) {
    document.getElementById('searchDepthValue').textContent = value;
}

async function calculate() {
    try {
        if (!Module) {
            await initializeModule();
        }
        
        const z = document.getElementById('numberInput').value;
        const MaxCodeLength = parseInt(document.getElementById('searchDepthValue').textContent);
        const ncpus = navigator.hardwareConcurrency || 4;

        // Clear previous results
        clearResultsTable();

        // Capture start time
        const startTime = new Date();

        // Create and start workers
        workers = [];
        for (let i = 0; i < ncpus; i++) {
            const worker = new Worker('worker.js');
            workers.push(worker);

            worker.onmessage = function(e) {
                const result = e.data;
                if (result.result === "SUCCESS") {
                    displayResult(result, startTime);
                    terminateAllWorkers();
                } else {
                    updateResultsTable(result);
                }
            };

            worker.onerror = function(error) {
                console.error('Worker error:', error);
            };

            // Include initDelay when starting the worker
            const initDelay =  1000*Math.random()+100; // 100ms delay between each worker start
            worker.postMessage({initDelay, z, MaxCodeLength, cpuId: i, ncpus});
        }

    } catch (error) {
        console.error("Error in calculate function:", error);
        alert("An error occurred while performing the calculation. Please try again.");
    }
}


function terminateAllWorkers() {
    workers.forEach(worker => worker.terminate());
    workers = [];
}

function displayResult(result, startTime) {
    const rpnCode = result.RPN;
    const endTime = new Date();
    const timeTaken = endTime - startTime;

    document.getElementById('resultInfix').textContent = Interpreter.removeRedundantParentheses(Interpreter.rpnToInfix(rpnCode.split(', ')));
    document.getElementById('resultRPN').textContent = rpnCode;
    document.getElementById('resultMathematica').textContent = Mma.rpnToMma(rpnCode.split(", ")) || "";
    document.getElementById('timing').textContent = `${timeTaken} ms`;
}

function updateResultsTable(result) {
    const table = document.getElementById('resultsTable');
    const row = table.insertRow(-1);
    row.insertCell(0).textContent = result.cpuId;
    row.insertCell(1).textContent = result.result;
    row.insertCell(2).textContent = Mma.rpnToMma(result.RPN.split(", ")) || "";
    row.insertCell(3).textContent = result.RPN;
    row.insertCell(4).textContent = result.result;
}

function clearResultsTable() {
    const table = document.getElementById('resultsTable');
    while (table.rows.length > 1) {
        table.deleteRow(1);
    }
}

function setupEventListeners() {
    const calculateButton = document.getElementById('calculateButton');
    if (calculateButton) {
        calculateButton.addEventListener('click', calculate);
    } else {
        console.error("Calculate button not found");
    }

    const slider = document.getElementById('searchDepth');
    if (slider) {
        slider.addEventListener('input', (event) => updateSearchDepthValue(event.target.value));
    } else {
        console.error("Search depth slider not found");
    }

    // Display number of CPUs
    const cpuSpan = document.getElementById('detectedCPUs');
    if (cpuSpan) {
        cpuSpan.textContent = navigator.hardwareConcurrency || 'Unknown';
    }
}

// Initialize everything when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    initializeModule();
});