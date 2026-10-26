/*
 * multi_tsp.cpp
 * -----------------------------------------------------------------------
 * MULTIPLE Travelling Salesman Problem (mTSP) — allocating delivery stops
 * among k delivery agents, all starting and ending at the same hub.
 *
 * WHY A TWO-PHASE APPROACH (important for viva):
 *   Solving mTSP exactly is even harder than TSP. The standard practical
 *   technique is "cluster-first, route-second":
 *
 *     PHASE 1 (Allocation)  : partition the stops into k balanced groups
 *     PHASE 2 (Routing)     : solve each group EXACTLY with DP + Bitmask
 *
 *   So the core DAA algorithm (Held-Karp DP+bitmask, O(n^2 * 2^n)) is
 *   still doing the real work — it just runs k times on smaller
 *   subproblems. This is also WHY the approach scales: splitting 12 stops
 *   into 3 agents means 3 subproblems of ~4 stops each (3 * 4^2 * 2^4)
 *   instead of one huge 12-stop problem (12^2 * 2^12).
 *
 * PHASE 1 DETAIL (balanced nearest-seed clustering):
 *   1. Pick k "seed" stops that are far apart from each other
 *      (first seed = stop farthest from the hub; each next seed = the stop
 *      maximising distance to the already-chosen seeds). This spreads the
 *      agents into different directions instead of overlapping.
 *   2. Assign every remaining stop to the nearest seed's cluster, subject
 *      to a capacity cap of ceil((n-1)/k) so no single agent is overloaded
 *      while another sits idle.
 *
 *   This is a HEURISTIC for the allocation step — it does not guarantee
 *   the globally optimal partition. That is an honest and expected
 *   limitation; say so in the viva. The per-agent ROUTE, however, IS
 *   provably optimal for the stops that agent was given.
 *
 * METRICS RETURNED:
 *   totalDistance  = sum of all agents' routes (total fuel/energy cost)
 *   makespan       = the LONGEST single agent route. This is what
 *                    determines when the last delivery is done, so it is
 *                    the metric that matters for customer waiting time.
 *
 * INPUT  (stdin JSON) : { "n": <int>, "k": <int>, "dist": [[...],...] }
 * OUTPUT (stdout JSON): { "agents":[{"agentId":0,"route":[0,3,1,0],
 *                          "distance":12.5}, ...],
 *                          "totalDistance":..., "makespan":...,
 *                          "algorithm":"...", "timeMs":... }
 *
 * Standalone test (no server needed):
 *   echo '{"n":5,"k":2,"dist":[[0,10,15,20,25],[10,0,35,25,30],[15,35,0,30,20],[20,25,30,0,15],[25,30,20,15,0]]}' | ./multi_tsp
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

struct JsonInput {
    int n;
    int k;
    vector<vector<double>> dist;
};

static void skipWs(const string &s, size_t &i) {
    while (i < s.size() && isspace((unsigned char)s[i])) i++;
}

static int readIntField(const string &raw, const string &key, int fallback) {
    size_t i = raw.find("\"" + key + "\"");
    if (i == string::npos) return fallback;
    i = raw.find(':', i) + 1;
    skipWs(raw, i);
    string numBuf;
    while (i < raw.size() && isdigit((unsigned char)raw[i])) numBuf += raw[i++];
    if (numBuf.empty()) return fallback;
    return stoi(numBuf);
}

JsonInput parseInput(const string &raw) {
    JsonInput out;
    out.n = readIntField(raw, "n", 0);
    out.k = readIntField(raw, "k", 1);

    size_t distPos = raw.find("\"dist\"");
    distPos = raw.find('[', distPos);

    out.dist.assign(out.n, vector<double>(out.n, 0.0));
    size_t pos = distPos;
    for (int r = 0; r < out.n; r++) {
        pos = raw.find('[', pos + 1);
        for (int c = 0; c < out.n; c++) {
            while (pos < raw.size() && !(isdigit((unsigned char)raw[pos]) || raw[pos] == '-')) pos++;
            size_t start = pos;
            while (pos < raw.size() && (isdigit((unsigned char)raw[pos]) || raw[pos] == '.' || raw[pos] == '-')) pos++;
            out.dist[r][c] = stod(raw.substr(start, pos - start));
        }
    }
    return out;
}

/*
 * PHASE 2: exact TSP over an arbitrary SUBSET of stops, always starting
 * and ending at the hub (global index 0).
 *
 * `stops` holds the GLOBAL indices this agent must serve. We build a
 * local index space: local 0 = hub, local 1..m = the agent's stops.
 * dp[mask][i] then has exactly the meaning from tsp.cpp.
 */
struct SubRoute {
    vector<int> route;   // global indices, starts and ends at 0
    double distance;
};

SubRoute solveExactTsp(const vector<int> &stops, const vector<vector<double>> &dist) {
    SubRoute result;
    result.distance = 0.0;
    result.route.push_back(0);

    int m = (int)stops.size();
    if (m == 0) {
        result.route.push_back(0);
        return result;
    }

    // local index 0 = hub, local i (1..m) = stops[i-1]
    int L = m + 1;
    vector<int> toGlobal(L);
    toGlobal[0] = 0;
    for (int i = 0; i < m; i++) toGlobal[i + 1] = stops[i];

    vector<vector<double>> d(L, vector<double>(L, 0.0));
    for (int i = 0; i < L; i++)
        for (int j = 0; j < L; j++)
            d[i][j] = dist[toGlobal[i]][toGlobal[j]];

    int FULL = 1 << L;
    vector<vector<double>> dp(FULL, vector<double>(L, INF));
    vector<vector<int>> parent(FULL, vector<int>(L, -1));
    dp[1][0] = 0.0;

    for (int mask = 1; mask < FULL; mask++) {
        if (!(mask & 1)) continue;
        for (int i = 0; i < L; i++) {
            if (!(mask & (1 << i))) continue;
            if (dp[mask][i] >= INF) continue;
            for (int j = 0; j < L; j++) {
                if (mask & (1 << j)) continue;
                int nextMask = mask | (1 << j);
                double cand = dp[mask][i] + d[i][j];
                if (cand < dp[nextMask][j]) {
                    dp[nextMask][j] = cand;
                    parent[nextMask][j] = i;
                }
            }
        }
    }

    int fullMask = FULL - 1;
    double best = INF;
    int lastCity = -1;
    for (int i = 1; i < L; i++) {
        if (dp[fullMask][i] >= INF) continue;
        double total = dp[fullMask][i] + d[i][0];
        if (total < best) {
            best = total;
            lastCity = i;
        }
    }

    // reconstruct in local space, then map back to global indices
    vector<int> localRoute;
    int mask = fullMask;
    int cur = lastCity;
    while (cur != -1) {
        localRoute.push_back(cur);
        int prev = parent[mask][cur];
        mask ^= (1 << cur);
        cur = prev;
    }
    reverse(localRoute.begin(), localRoute.end());

    result.route.clear();
    for (int lc : localRoute) result.route.push_back(toGlobal[lc]);
    result.route.push_back(0);
    result.distance = best;
    return result;
}

int main() {
    std::ostringstream ss;
    ss << cin.rdbuf();
    string raw = ss.str();

    JsonInput input = parseInput(raw);
    int n = input.n;
    int k = max(1, input.k);
    auto &dist = input.dist;

    auto t0 = chrono::high_resolution_clock::now();

    // Stops are every node except the hub (index 0)
    vector<int> allStops;
    for (int i = 1; i < n; i++) allStops.push_back(i);

    if (k > (int)allStops.size()) k = max(1, (int)allStops.size());

    // ---------------- PHASE 1: balanced nearest-seed clustering ----------------
    vector<vector<int>> clusters(k);

    if (!allStops.empty()) {
        vector<int> seeds;
        // First seed: the stop farthest from the hub.
        int firstSeed = allStops[0];
        for (int s : allStops)
            if (dist[0][s] > dist[0][firstSeed]) firstSeed = s;
        seeds.push_back(firstSeed);

        // Remaining seeds: maximise distance to the nearest existing seed,
        // which pushes agents into distinct directions.
        while ((int)seeds.size() < k) {
            int bestStop = -1;
            double bestSep = -1.0;
            for (int s : allStops) {
                if (find(seeds.begin(), seeds.end(), s) != seeds.end()) continue;
                double nearestSeed = INF;
                for (int sd : seeds) nearestSeed = min(nearestSeed, dist[s][sd]);
                if (nearestSeed > bestSep) {
                    bestSep = nearestSeed;
                    bestStop = s;
                }
            }
            if (bestStop == -1) break;
            seeds.push_back(bestStop);
        }

        int cap = (int)ceil((double)allStops.size() / (double)k);

        for (int i = 0; i < (int)seeds.size(); i++) clusters[i].push_back(seeds[i]);

        for (int s : allStops) {
            if (find(seeds.begin(), seeds.end(), s) != seeds.end()) continue;
            int bestCluster = -1;
            double bestDist = INF;
            for (int c = 0; c < k; c++) {
                if ((int)clusters[c].size() >= cap) continue; // balance constraint
                double dToSeed = dist[s][seeds[c]];
                if (dToSeed < bestDist) {
                    bestDist = dToSeed;
                    bestCluster = c;
                }
            }
            // If every cluster is at capacity, fall back to the nearest seed overall.
            if (bestCluster == -1) {
                for (int c = 0; c < k; c++) {
                    double dToSeed = dist[s][seeds[c]];
                    if (dToSeed < bestDist) {
                        bestDist = dToSeed;
                        bestCluster = c;
                    }
                }
            }
            clusters[bestCluster].push_back(s);
        }
    }

    // ---------------- PHASE 2: exact DP TSP per agent ----------------
    vector<SubRoute> agentRoutes;
    double totalDistance = 0.0;
    double makespan = 0.0;

    for (int c = 0; c < k; c++) {
        SubRoute sr = solveExactTsp(clusters[c], dist);
        agentRoutes.push_back(sr);
        totalDistance += sr.distance;
        makespan = max(makespan, sr.distance);
    }

    auto t1 = chrono::high_resolution_clock::now();
    double ms = chrono::duration<double, milli>(t1 - t0).count();

    // ---------------- emit JSON ----------------
    cout << fixed << setprecision(2);
    cout << "{\"agents\":[";
    for (int c = 0; c < (int)agentRoutes.size(); c++) {
        cout << "{\"agentId\":" << c << ",\"route\":[";
        for (size_t x = 0; x < agentRoutes[c].route.size(); x++) {
            cout << agentRoutes[c].route[x];
            if (x + 1 < agentRoutes[c].route.size()) cout << ",";
        }
        cout << "],\"stopCount\":" << clusters[c].size();
        cout << ",\"distance\":" << agentRoutes[c].distance << "}";
        if (c + 1 < (int)agentRoutes.size()) cout << ",";
    }
    cout << "],";
    cout << "\"agentCount\":" << agentRoutes.size() << ",";
    cout << "\"totalDistance\":" << totalDistance << ",";
    cout << "\"makespan\":" << makespan << ",";
    cout << "\"algorithm\":\"Cluster-first (balanced seeds) + exact DP+Bitmask per agent\",";
    cout << "\"perAgentOptimal\":true,";
    cout << "\"timeMs\":" << setprecision(4) << ms;
    cout << "}" << endl;

    return 0;
}
