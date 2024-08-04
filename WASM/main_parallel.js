import * as Interpreter from './RPN_interpreter.js';
import * as Evaluator from './RPN_evaluator.js';
import * as Mma from './RPN_to_Mma_interpreter.js';

let Module;
let workers = [];
let inputPrecision;

async function initializeModule() {
    Module = await window.moduleReadyPromise;
    console.log("Module initialized in main_parallel.js");
}

function updateSearchDepthValue(value) {
    document.getElementById('searchDepthValue').textContent = value;
}

function extractPrecision(inputString) {
    // Remove any leading/trailing whitespace
    inputString = inputString.trim();
    
    // Handle scientific notation
    let parts = inputString.split(/e/i);
    let mainPart = parts[0];
    
    // Find the decimal point
    let decimalIndex = mainPart.indexOf('.');
    
    if (decimalIndex === -1) {
        // If there's no decimal point, precision is 1
        return 1;
    } else {
        // Count the number of digits after the decimal point
        let fractionalPart = mainPart.slice(decimalIndex + 1);
        let significantDigits = fractionalPart.replace(/0+$/, '').length;
        
        // Precision is 1 divided by 10 raised to the power of significant digits
        return Math.pow(10, -significantDigits);
    }
}

async function calculate() {
    try {
        if (!Module) {
            await initializeModule();
        }
        
        const z = document.getElementById('numberInput').value;
        const MaxCodeLength = parseInt(document.getElementById('searchDepthValue').textContent);
        const ncpus = navigator.hardwareConcurrency || 4;

        // Extract precision from input
        inputPrecision = extractPrecision(z);
        console.log(inputPrecision);


        // Clear previous results
        clearResultsTable();

        // Capture start time
        const startTime = new Date();

        // Create and start workers
        workers = [];
        for (let i = 0; i < ncpus; i++) {
            //const worker = new Worker('worker.js');
            const worker = new Worker('worker.js?v=' + Date.now() + i);
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
    const timeTaken = (endTime - startTime)/1000.0;

    document.getElementById('resultInfix').value = Interpreter.removeRedundantParentheses(Interpreter.rpnToInfix(rpnCode.split(', ')));
    document.getElementById('resultRPN').textContent = rpnCode;
    document.getElementById('resultMathematica').textContent = Mma.rpnToMma(rpnCode.split(", ")) || "";
    document.getElementById('timing').textContent = `${timeTaken} s`;
    document.getElementById('resultNumeric').value = Evaluator.evaluateRPN(rpnCode.split(", "));
}

function updateResultsTable(result) {
    const table = document.getElementById('resultsTable');
    const row = table.insertRow(-1);
    const rpnCode = result.RPN.split(", ");
    const K = rpnCode.length; // RPN code length
    const n = 36; // Number of calculator buttons
    const sigma = 2.2e-16; // Machine epsilon (default error)
    
    row.insertCell(0).textContent = result.cpuId;
    row.insertCell(1).textContent = Evaluator.evaluateRPN(rpnCode) || "";
    row.insertCell(2).textContent = Mma.rpnToMma(rpnCode) || "";
    row.insertCell(3).textContent = result.result;
    row.insertCell(4).textContent = result.ABS_ERR;
    
    const compressionRatio = calculateCompressionRatio(result.ABS_ERR, inputPrecision, K, n);
    row.insertCell(5).textContent = compressionRatio.toFixed(2); // Display with 2 decimal places
    
    row.insertCell(6).textContent = result.RPN;
}


function calculateCompressionRatio(epsilon, sigma, K, n) {
    const precision = Math.max(epsilon, sigma);
    const numerator = -Math.log10(precision);
    const denominator = K * Math.log10(n);
    return numerator / denominator;
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