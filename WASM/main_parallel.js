import * as Interpreter from './RPN_interpreter.js';
import * as Evaluator from './RPN_evaluator.js';
import * as Mma from './RPN_to_Mma_interpreter.mjs';


let Module;
let workers = [];
let activeWorkers = 0;
let inputPrecision;


async function initializeModule() {
    Module = await window.moduleReadyPromise;
    console.log("Module initialized in main_parallel.js");
}

function updateSearchDepthValue(value) {
    document.getElementById('searchDepthValue').textContent = value;
}

function extractPrecision(inputString) {

    //console.log(inputString);
    // Remove any leading/trailing whitespace
    //inputString = inputString.trim();
    
    // Parse the input string to a number
    let value = parseFloat(inputString);
    //console.log(value);
    
    // Handle scientific notation
    let parts = inputString.split(/e/i);
    let mainPart = parts[0];
    
    // Find the decimal point
    let decimalIndex = mainPart.indexOf('.');
    //console.log(inputString);
    
    let absolutePrecision;
    if (decimalIndex === -1) {
        // If there's no decimal point, use machine precision
        absolutePrecision = Number.EPSILON;
    } else {
        // Count the number of digits after the decimal point
        let fractionalPart = mainPart.slice(decimalIndex + 1);
        //let significantDigits = fractionalPart.replace(/0+$/, '').length;
        let significantDigits = fractionalPart.length;
        
        // Absolute precision is 1 divided by 10 raised to the power of significant digits
        absolutePrecision = 0.5*Math.pow(10, -significantDigits);
    }
    
    // Calculate relative precision
    let relativePrecision = absolutePrecision / Math.abs(value);
    
    //console.log(absolutePrecision);    
   // console.log(relativePrecision);    

    return relativePrecision;
}



async function calculate() {
    try {
        if (!Module) {
            await initializeModule();
        }
        
        const inputElement = document.getElementById('numberInput');
        const inputValue = inputElement.value;
        const z = parseFloat(inputValue);
        const MaxCodeLength = parseInt(document.getElementById('searchDepthValue').textContent);
        const ncpus = navigator.hardwareConcurrency || 7;
        //const ncpus = 2; // For debug

        // Extract precision from input
        console.log("Input element:", inputElement);
        console.log("Input value:", inputValue);
        console.log("z=", z);
        inputPrecision = extractPrecision(inputValue);


        // Clear previous results
        clearResultsTable();
        clearResults();

        // Capture start time
        const startTime = new Date();

        // Create and start workers
        workers = [];
        activeWorkers = ncpus;
        for (let i = 0; i < ncpus; i++) {
            const worker = new Worker('worker.js');
            //const worker = new Worker('worker.js?v=' + Date.now() + i);
            workers.push(worker);

            worker.onmessage = function(e) {
                const result = e.data;

                if (result.results) {
                    result.results.forEach(result => {
                        updateResultsTable(result);
                        //console.log("From message");
                        //console.log(result);
                    });
                }


                if (result.result === "SUCCESS") {
                    displayResult(result, startTime);
                    terminateAllWorkers();
                    updateResultsTable(result);
                } else {
                    updateResultsTable(result);
                    if (result.status === "FINISHED") {
                    activeWorkers--;
                    }
                    console.log(activeWorkers);
                    if (activeWorkers === 0) {
                      // All workers have finished
                      displayResult(result, startTime);
                    }
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
    activeWorkers = 0;
}

function clearResults() {
    document.getElementById('resultInfix').value = '';
    document.getElementById('resultRPN').textContent = '';
    document.getElementById('resultMathematica').textContent = '';
    document.getElementById('timing').textContent = '';
    document.getElementById('resultNumeric').value = '';
}

function displayResult(result, startTime) {
    const rpnCode = result.RPN;
    const endTime = new Date();
    const timeTaken = (endTime - startTime)/1000.0;



    if (result.result === "SUCCESS") {
      document.getElementById('resultInfix').value = Interpreter.removeRedundantParentheses(Interpreter.rpnToInfix(rpnCode.split(', ')));
      document.getElementById('resultRPN').textContent = rpnCode;
      document.getElementById('resultMathematica').textContent = Mma.rpnToMma(rpnCode.split(", ")) || "";
      document.getElementById('timing').textContent = `${timeTaken} s`;
      document.getElementById('resultNumeric').value = Evaluator.evaluateRPN(rpnCode.split(", "));
    } else {
      document.getElementById('resultInfix').value = 'Not found';
      document.getElementById('resultRPN').textContent = 'PI PI PI PI PI PI PI PI .....';
      document.getElementById('resultMathematica').textContent = '?';
      document.getElementById('timing').textContent = `${timeTaken} s`;
      document.getElementById('resultNumeric').value = 'Check table';
    };
}

function updateResultsTable(result) {

    //console.log("From updateResultsTable");
    //console.log(result);
    if (!window.dataTable) {
        console.error('DataTable not initialized');
        return;
    }
    
    const rpnCode = result.RPN.split(", ");
    const K = rpnCode.length;
    const n = 36;
    
    const compressionRatio = calculateCompressionRatio(result.REL_ERR, inputPrecision, K, n);
    
    window.dataTable.row.add([
        result.cpuId,
        Evaluator.evaluateRPN(rpnCode) || "",
        Mma.rpnToMma(rpnCode) || "",
        result.result,
        result.REL_ERR,
        compressionRatio.toFixed(7),
        result.RPN
    ]).draw(false);
}

function clearResultsTable() {
    if (window.dataTable) {
        window.dataTable.clear().draw();
    }
}


function calculateCompressionRatio(epsilon, sigma, K, n) {
    const precision = Math.max(epsilon, sigma);
    const numerator = -Math.log10(precision);
    const denominator = K * Math.log10(n);
    return numerator / denominator;
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

    // New code for handling paste events to remove whitespaces
    const inputElement = document.getElementById('numberInput');
    
    inputElement.addEventListener('paste', (event) => {
        event.preventDefault();
        let pastedText = (event.clipboardData || window.clipboardData).getData('text');
        pastedText = pastedText.replace(/\s/g, '');
        inputElement.value = pastedText;
    });


});