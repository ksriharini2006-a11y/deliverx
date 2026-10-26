// Exact DP vs brute force, heuristic sanity - on random ASYMMETRIC matrices
// (like one-way roads). Requires the compiled C++ binaries in ../cpp.
const test = require("node:test");
const assert = require("node:assert/strict");
const { runTsp, runHeuristic } = require("../utils/runCpp");

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function randMatrix(n) {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Math.round((1 + rnd() * 20) * 100) / 100)));
}

function cost(route, d) {
  let c = 0;
  for (let i = 0; i < route.length - 1; i++) c += d[route[i]][route[i + 1]];
  return c;
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}

function brute(d, mode, fixedEnd) {
  const n = d.length;
  const mids = [];
  for (let i = 1; i < n; i++) if (i !== fixedEnd) mids.push(i);
  let best = Infinity;
  for (const p of permutations(mids)) {
    const route = [0, ...p];
    if (mode === "closed") route.push(0);
    if (mode === "fixedEnd") route.push(fixedEnd);
    best = Math.min(best, cost(route, d));
  }
  return best;
}

test("exact DP equals brute force (closed, open, fixedEnd) on asymmetric matrices", async () => {
  for (let n = 3; n <= 8; n++) {
    for (let rep = 0; rep < 3; rep++) {
      const d = randMatrix(n);
      const closed = await runTsp(d);
      assert.ok(Math.abs(closed.distance - brute(d, "closed")) < 1e-3, `closed n=${n}`);
      assert.equal(closed.route[0], 0);
      assert.equal(closed.route[closed.route.length - 1], 0);
      assert.ok(Math.abs(closed.distance - cost(closed.route, d)) < 1e-3, "reported cost matches route");

      const open = await runTsp(d, { open: true });
      assert.ok(Math.abs(open.distance - brute(d, "open")) < 1e-3, `open n=${n}`);
      assert.equal(open.route.length, n);

      const fe = n - 1;
      const fixed = await runTsp(d, { fixedEnd: fe });
      assert.ok(Math.abs(fixed.distance - brute(d, "fixedEnd", fe)) < 1e-3, `fixedEnd n=${n}`);
      assert.equal(fixed.route[fixed.route.length - 1], fe);
    }
  }
});

test("open route is never longer than the closed tour", async () => {
  for (let k = 0; k < 10; k++) {
    const d = randMatrix(7);
    const c = await runTsp(d);
    const o = await runTsp(d, { open: true });
    assert.ok(o.distance <= c.distance + 1e-6);
  }
});

test("heuristic: valid route, 2-opt never worse than nearest neighbor, never better than optimum", async () => {
  for (let n = 4; n <= 10; n++) {
    for (const opts of [{}, { open: true }, { fixedEnd: n - 1 }]) {
      const d = randMatrix(n);
      const h = await runHeuristic(d, opts);
      const exact = await runTsp(d, opts);
      const inner = h.route.filter((x, i) => i > 0 && !(i === h.route.length - 1 && (h.mode === "closed" || h.mode === "fixedEnd")));
      assert.equal(new Set(h.route.slice(1)).size >= n - 1, true);
      assert.ok(h.distance <= h.nnDistance + 1e-6, "2-opt must not be worse than NN");
      assert.ok(h.distance >= exact.distance - 1e-6, "heuristic cannot beat the exact optimum");
      assert.equal(h.optimal, false);
      assert.ok(Math.abs(h.distance - cost(h.route, d)) < 1e-3);
      assert.ok(inner.length >= 1);
    }
  }
});

test("heuristic handles 40 points quickly", async () => {
  const d = randMatrix(40);
  const t0 = Date.now();
  const h = await runHeuristic(d);
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(h.route.length, 41);
});
