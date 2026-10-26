/*
 * tspService.js - chooses and runs the DAA algorithm.
 *
 *   points <= EXACT_MAX_NODES : EXACT Held-Karp DP + Bitmask  (C++ tsp)
 *                               guaranteed optimal, O(n^2 * 2^n)
 *   larger                    : Nearest Neighbor + 2-opt       (C++ heuristic)
 *                               fast, usually good, NOT guaranteed optimal
 *
 * The heuristic is ALWAYS run as well. Its plain Nearest Neighbor result is
 * the comparison baseline, and when the exact DP also ran, the 2-opt result
 * shows how close a heuristic gets to the true optimum.
 *
 * Costs handed to C++ are in ONE unit (km or minutes) chosen by the
 * objective (shortest distance / shortest time).
 */

const config = require("./config");
const { runTsp, runHeuristic } = require("../utils/runCpp");

const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * @param {number[][]} cost directed cost matrix, index 0 = start
 * @param {{open?:boolean, fixedEnd?:number, exactMaxNodes?:number}} opts
 */
async function solve(cost, opts = {}) {
  const n = cost.length;
  const exactMax = opts.exactMaxNodes || config.EXACT_MAX_NODES;
  const clean = cost.map((row) => row.map((v) => round4(v)));
  const policy = { open: !!opts.open, fixedEnd: opts.fixedEnd };

  const useExact = n <= exactMax;
  const [heur, exact] = await Promise.all([
    runHeuristic(clean, { ...policy, twoOpt: true }),
    useExact ? runTsp(clean, policy) : Promise.resolve(null),
  ]);

  const chosen = exact || heur;
  return {
    route: chosen.route,
    cost: chosen.distance,
    usedExact: !!exact,
    optimal: !!exact,
    algorithm: exact ? "Dynamic Programming + Bitmasking (Held-Karp)" : "Nearest Neighbor + 2-opt (heuristic)",
    mode: chosen.mode,
    computeTimeMs: chosen.timeMs,
    nearestNeighbor: { route: heur.nnRoute, cost: heur.nnDistance },
    twoOpt: { route: heur.route, cost: heur.distance, moves: heur.twoOptMoves },
    exactMaxNodes: exactMax,
  };
}

function explain(result, stopCount) {
  if (result.usedExact) {
    return (
      `With ${stopCount} stops the exact Held-Karp dynamic-programming algorithm was used. It checks every subset of ` +
      `stops with a bitmask and is guaranteed to find the best possible order for the chosen goal ` +
      `(time O(n²·2ⁿ), space O(n·2ⁿ)). Exact search is used up to ${result.exactMaxNodes - 1} stops.`
    );
  }
  return (
    `With ${stopCount} stops, exact dynamic programming would need too much time and memory ` +
    `(it grows as 2ⁿ), so Nearest Neighbor followed by 2-opt improvement was used. This is a heuristic: it usually ` +
    `gives a good route but is NOT guaranteed to be the globally optimal one.`
  );
}

module.exports = { solve, explain };
