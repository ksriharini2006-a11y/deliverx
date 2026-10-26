/*
 * tsp.cpp
 * -----------------------------------------------------------------------
 * Travelling Salesman Problem — EXACT solution using
 * Dynamic Programming + Bitmasking (Held-Karp algorithm).
 *
 * WHY THIS APPROACH (for viva):
 *   Brute force checks all (n-1)! permutations of routes -> O(n!).
 *   DP + bitmask reuses overlapping subproblems: "cheapest way to have
 *   visited exactly this SET of cities, ending at city i" is computed
 *   once and reused, instead of being recomputed for every permutation
 *   that happens to visit the same set in a different order.
 *   This brings the complexity down to O(n^2 * 2^n).
 *
 * STATE:
 *   dp[mask][i] = minimum cost to start at depot (city 0), visit every
 *                 city in `mask`, and currently be standing at city i.
 *   mask is an n-bit integer; bit j == 1 means city j has been visited.
 *
 * RECURRENCE:
 *   dp[mask][i] = min over all j in mask, j != i, bit0(mask) == 1 :
 *                     dp[mask without i][j] + dist[j][i]
 *   Base case: dp[1][0] = 0   (mask = 000...001, only depot visited, at depot)
 *
 * ANSWER:
 *   min over all i of ( dp[FULL_MASK][i] + dist[i][0] )   -> closes the loop
 *
 * ROUTE RECONSTRUCTION:
 *   parent[mask][i] stores which city j was visited immediately before i
 *   for the optimal dp[mask][i]. We walk this table backwards from the
 *   best final (mask, i) pair to rebuild the actual order of cities.
 *
 * COMPLEXITY:
 *   Time:  O(n^2 * 2^n)
 *   Space: O(n * 2^n)
 *   Practical for n up to ~18 on a laptop; a delivery-hub demo with
 *   5-10 locations solves instantly.
 *
 * ROUTE POLICIES (optional input keys, default = closed tour):
 *   closed (default)   start at 0, visit everyone, RETURN to 0.
 *   "open": true       start at 0, visit everyone, finish at the last stop
 *                      (answer = min over i of dp[FULL][i], no return leg).
 *   "fixedEnd": e      start at 0, visit everyone, finish exactly at node e
 *                      (used to re-plan the remaining stops and still end at
 *                      the depot). Node e may only be visited last.
 *   The matrix may be ASYMMETRIC (one-way roads): the recurrence always
 *   uses dist[from][to], so directed road distances work unchanged.
 *
 * INPUT  (via stdin): JSON  { "n": <int>, "dist": [[...],[...],...],
 *                              "open": false, "fixedEnd": -1 }
 *                      dist is an n x n matrix, dist[i][j] = cost of going
 *                      from i to j (km or minutes - any single unit).
 *                      City index 0 is ALWAYS the start point.
 * OUTPUT (to stdout): JSON  { "route": [0, 2, 3, 1, 0],
 *                              "distance": 42.6,
 *                              "algorithm": "DP+Bitmask (Held-Karp)",
 *                              "optimal": true,
 *                              "timeMs": 0.12 }
 *
 * This program has ZERO knowledge of HTTP, Express, or the database.
 * It is a pure, standalone algorithm — run it directly from a terminal
 * to demonstrate the DAA concept without any server running:
 *
 *   echo '{"n":4,"dist":[[0,10,15,20],[10,0,35,25],[15,35,0,30],[20,25,30,0]]}' | ./tsp
 * -----------------------------------------------------------------------
 */

#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>
#include <chrono>
#include <cctype>
#include <iomanip>
#include <cmath>
using namespace std;

const double INF = 1e18;

// ---------- extremely small JSON helpers (no external library needed) ----------
// We only need to parse a flat { "n": int, "dist": [[..],[..]] } object,
// so a tiny hand-rolled parser is simpler and more beginner-friendly than
// pulling in a full JSON library and linking it.

struct JsonInput {
    int n;
    vector<vector<double>> dist;
    bool open = false;   // true -> no return leg
    int fixedEnd = -1;   // >= 1 -> route must finish at this node
};

static void skipWs(const string &s, size_t &i) {
    while (i < s.size() && isspace((unsigned char)s[i])) i++;
}

JsonInput parseInput(const string &raw) {
    JsonInput out;
    size_t i = raw.find("\"n\"");
    i = raw.find(':', i) + 1;
    skipWs(raw, i);
    string numBuf;
    while (i < raw.size() && (isdigit((unsigned char)raw[i]))) numBuf += raw[i++];
    out.n = stoi(numBuf);

    size_t distPos = raw.find("\"dist\"");
    distPos = raw.find('[', distPos); // first '[' of the outer array

    // optional policy keys
    size_t op = raw.find("\"open\"");
    if (op != string::npos) {
        size_t c = raw.find(':', op) + 1;
        skipWs(raw, c);
        out.open = raw.compare(c, 4, "true") == 0;
    }
    size_t fe = raw.find("\"fixedEnd\"");
    if (fe != string::npos) {
        size_t c = raw.find(':', fe) + 1;
        skipWs(raw, c);
        size_t st = c;
        while (c < raw.size() && (isdigit((unsigned char)raw[c]) || raw[c] == '-')) c++;
        if (c > st) out.fixedEnd = stoi(raw.substr(st, c - st));
    }

    out.dist.assign(out.n, vector<double>(out.n, 0.0));
    size_t pos = distPos;
    for (int r = 0; r < out.n; r++) {
        pos = raw.find('[', pos + 1);
        for (int c = 0; c < out.n; c++) {
            // move to next number
            while (pos < raw.size() && !(isdigit((unsigned char)raw[pos]) || raw[pos] == '-')) pos++;
            size_t start = pos;
            while (pos < raw.size() && (isdigit((unsigned char)raw[pos]) || raw[pos] == '.' || raw[pos] == '-')) pos++;
            out.dist[r][c] = stod(raw.substr(start, pos - start));
        }
    }
    return out;
}

int main() {
    // Read entire stdin into one string
    std::ostringstream ss;
    ss << cin.rdbuf();
    string raw = ss.str();

    JsonInput input = parseInput(raw);
    int n = input.n;
    auto &dist = input.dist;

    auto t0 = chrono::high_resolution_clock::now();

    bool openRoute = input.open;
    int fixedEnd = (input.fixedEnd >= 1 && input.fixedEnd < n) ? input.fixedEnd : -1;
    string mode = fixedEnd >= 0 ? "fixedEnd" : (openRoute ? "open" : "closed");

    if (n <= 1) {
        cout << "{\"route\":[0],\"distance\":0,\"algorithm\":\"DP+Bitmask (Held-Karp)\",\"optimal\":true,\"timeMs\":0}" << endl;
        return 0;
    }

    int FULL = 1 << n;
    // dp[mask][i]: min cost to have visited exactly `mask`, ending at city i
    vector<vector<double>> dp(FULL, vector<double>(n, INF));
    // parent[mask][i]: previous city visited before arriving at i, for this mask
    vector<vector<int>> parent(FULL, vector<int>(n, -1));

    dp[1][0] = 0.0; // start: only depot (bit 0) visited, standing at depot

    for (int mask = 1; mask < FULL; mask++) {
        if (!(mask & 1)) continue; // depot must always be part of a valid mask
        for (int i = 0; i < n; i++) {
            if (!(mask & (1 << i))) continue;
            if (dp[mask][i] >= INF) continue;

            for (int j = 0; j < n; j++) {
                if (mask & (1 << j)) continue; // j already visited
                int nextMask = mask | (1 << j);
                // a fixed final node may only be entered when it completes the tour
                if (fixedEnd >= 0 && j == fixedEnd && nextMask != FULL - 1) continue;
                double cand = dp[mask][i] + dist[i][j];
                if (cand < dp[nextMask][j]) {
                    dp[nextMask][j] = cand;
                    parent[nextMask][j] = i;
                }
            }
        }
    }

    // Pick the best finish according to the route policy
    double best = INF;
    int lastCity = -1;
    int fullMask = FULL - 1;
    for (int i = 1; i < n; i++) {
        if (dp[fullMask][i] >= INF) continue;
        if (fixedEnd >= 0 && i != fixedEnd) continue;
        double total = dp[fullMask][i] + (openRoute || fixedEnd >= 0 ? 0.0 : dist[i][0]);
        if (total < best) {
            best = total;
            lastCity = i;
        }
    }

    // Reconstruct route by walking parent[] backwards
    vector<int> route;
    int mask = fullMask;
    int cur = lastCity;
    while (cur != -1) {
        route.push_back(cur);
        int prev = parent[mask][cur];
        mask ^= (1 << cur);
        cur = prev;
    }
    reverse(route.begin(), route.end());
    if (!openRoute && fixedEnd < 0) route.push_back(0); // closed tour: return to depot

    auto t1 = chrono::high_resolution_clock::now();
    double ms = chrono::duration<double, milli>(t1 - t0).count();

    // ---------- emit JSON ----------
    cout << fixed << setprecision(4);
    cout << "{";
    cout << "\"route\":[";
    for (size_t k = 0; k < route.size(); k++) {
        cout << route[k];
        if (k + 1 < route.size()) cout << ",";
    }
    cout << "],";
    cout << "\"distance\":" << best << ",";
    cout << "\"algorithm\":\"DP+Bitmask (Held-Karp)\",";
    cout << "\"optimal\":true,";
    cout << "\"mode\":\"" << mode << "\",";
    cout << "\"timeMs\":" << setprecision(4) << ms;
    cout << "}" << endl;

    return 0;
}
