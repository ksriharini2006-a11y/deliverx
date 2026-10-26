/*
 * runCpp.js
 * -----------------------------------------------------------------------
 * The ONE place in the backend that talks to the C++ binaries.
 * Everything else (controllers, routes) just calls runTsp() / runGreedy()
 * and gets back a plain JS object — they never know a child process is
 * involved.
 *
 * HOW IT WORKS:
 *   1. child_process.spawn() starts the compiled ./cpp/tsp (or ./cpp/greedy)
 *      binary as a separate OS process.
 *   2. We write the distance matrix as JSON to the binary's stdin, then
 *      close stdin (binary.stdin.end()) so the C++ program's
 *      `cin.rdbuf()` read knows the input is finished.
 *   3. We collect everything the binary prints to stdout.
 *   4. When the process exits, we JSON.parse() the collected output and
 *      resolve a Promise with it.
 *
 * This mirrors exactly what you can do by hand in a terminal:
 *   echo '<json>' | ./cpp/tsp
 * -----------------------------------------------------------------------
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const CPP_DIR = path.join(__dirname, "..", "..", "cpp");

function resolveBinary(name) {
  // On Windows the compiled file is name.exe; on Mac/Linux it has no extension.
  const winPath = path.join(CPP_DIR, `${name}.exe`);
  const unixPath = path.join(CPP_DIR, name);
  return fs.existsSync(winPath) ? winPath : unixPath;
}

function runBinary(binaryName, inputObj) {
  return new Promise((resolve, reject) => {
    const binaryPath = resolveBinary(binaryName);

    if (!fs.existsSync(binaryPath)) {
      reject(
        new Error(
          `Compiled binary not found at ${binaryPath}. Did you run ` +
            `"g++ -O2 -std=c++17 -o ${binaryName} ${binaryName}.cpp" inside the cpp/ folder?`
        )
      );
      return;
    }

    const child = spawn(binaryPath);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    child.on("error", (err) => reject(err));

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${binaryName} exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Failed to parse ${binaryName} output as JSON: ${stdout}`));
      }
    });

    child.stdin.write(JSON.stringify(inputObj));
    child.stdin.end();
  });
}

/**
 * Exact Held-Karp DP + Bitmask.
 * @param {number[][]} distMatrix  directed cost matrix (index 0 = start)
 * @param {{open?:boolean, fixedEnd?:number}} [opts]
 *   open     -> no return leg (finish at the last stop)
 *   fixedEnd -> finish exactly at this node index (>= 1)
 * @returns {Promise<{route:number[], distance:number, algorithm:string, optimal:boolean, mode:string, timeMs:number}>}
 */
function runTsp(distMatrix, opts = {}) {
  const input = { n: distMatrix.length, dist: distMatrix };
  if (opts.open) input.open = true;
  if (opts.fixedEnd !== undefined && opts.fixedEnd !== null && opts.fixedEnd >= 1) input.fixedEnd = opts.fixedEnd;
  return runBinary("tsp", input);
}

/**
 * Scalable heuristic: Nearest Neighbor, then 2-opt improvement. NOT guaranteed
 * optimal. Also returns the plain Nearest Neighbor route (nnRoute/nnDistance).
 * @param {number[][]} distMatrix
 * @param {{open?:boolean, fixedEnd?:number, twoOpt?:boolean}} [opts]
 */
function runHeuristic(distMatrix, opts = {}) {
  const input = { n: distMatrix.length, dist: distMatrix, twoOpt: opts.twoOpt !== false };
  if (opts.open) input.open = true;
  if (opts.fixedEnd !== undefined && opts.fixedEnd !== null && opts.fixedEnd >= 1) input.fixedEnd = opts.fixedEnd;
  return runBinary("heuristic", input);
}

/**
 * @param {number[][]} distMatrix
 * @returns {Promise<{route:number[], distance:number, algorithm:string, optimal:boolean, timeMs:number}>}
 */
function runGreedy(distMatrix) {
  return runBinary("greedy", { n: distMatrix.length, dist: distMatrix });
}

/**
 * Multi-agent (mTSP): splits stops among k delivery agents, then solves
 * each agent's route exactly with DP+Bitmask.
 * @param {number[][]} distMatrix
 * @param {number} k - number of delivery agents
 */
function runMultiTsp(distMatrix, k) {
  return runBinary("multi_tsp", { n: distMatrix.length, k, dist: distMatrix });
}

module.exports = { runTsp, runGreedy, runMultiTsp, runHeuristic };
