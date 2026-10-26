/*
 * heuristic.cpp
 * -----------------------------------------------------------------------
 * Scalable route heuristic for LARGER numbers of stops, where the exact
 * Held-Karp DP (tsp.cpp, O(n^2 * 2^n)) becomes too slow / memory hungry:
 *
 *   1. NEAREST NEIGHBOR   - from the start, always drive to the closest
 *                           unvisited stop. O(n^2). Fast but can be far
 *                           from optimal.
 *   2. 2-OPT IMPROVEMENT  - repeatedly take two route legs, reverse the
 *                           stops between them, and keep the change if the
 *                           total gets shorter. Stops when no single
 *                           reversal helps (a "local optimum").
 *
 * IMPORTANT (honest claim): this is a HEURISTIC. It usually gives a good
 * route but it is NOT guaranteed to be the globally optimal one. The
 * program reports "optimal": false so the UI never claims otherwise.
 *
 * Route policies match tsp.cpp:
 *   closed (default)  start at 0, visit all, return to 0
 *   "open": true      start at 0, visit all, finish at the last stop
 *   "fixedEnd": e     start at 0, visit all, finish exactly at node e
 * The matrix can be asymmetric (one-way roads); every cost is dist[from][to].
 *
 * INPUT  (stdin):  { "n": N, "dist": [[...]], "open": false, "fixedEnd": -1,
 *                    "twoOpt": true }
 *   "twoOpt": false  -> return only the plain Nearest Neighbor route
 *                       (used as the comparison baseline).
 * OUTPUT (stdout): { "route": [...], "distance": x, "nnRoute": [...],
 *                    "nnDistance": y, "algorithm": "...", "optimal": false,
 *                    "mode": "...", "twoOptMoves": k, "timeMs": t }
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

static void skipWs(const string &s, size_t &i) {
    while (i < s.size() && isspace((unsigned char)s[i])) i++;
}

struct Input {
    int n = 0;
    vector<vector<double>> dist;
    bool open = false;
    int fixedEnd = -1;
    bool twoOpt = true;
};

static bool readBool(const string &raw, const string &key, bool def) {
    size_t p = raw.find("\"" + key + "\"");
    if (p == string::npos) return def;
    size_t c = raw.find(':', p) + 1;
    skipWs(raw, c);
    return raw.compare(c, 4, "true") == 0;
}

Input parseInput(const string &raw) {
    Input in;
    size_t i = raw.find("\"n\"");
    i = raw.find(':', i) + 1;
    skipWs(raw, i);
    string num;
    while (i < raw.size() && isdigit((unsigned char)raw[i])) num += raw[i++];
    in.n = stoi(num);

    in.open = readBool(raw, "open", false);
    in.twoOpt = readBool(raw, "twoOpt", true);
    size_t fe = raw.find("\"fixedEnd\"");
    if (fe != string::npos) {
        size_t c = raw.find(':', fe) + 1;
        skipWs(raw, c);
        size_t st = c;
        while (c < raw.size() && (isdigit((unsigned char)raw[c]) || raw[c] == '-')) c++;
        if (c > st) in.fixedEnd = stoi(raw.substr(st, c - st));
    }

    size_t pos = raw.find('[', raw.find("\"dist\""));
    in.dist.assign(in.n, vector<double>(in.n, 0.0));
    for (int r = 0; r < in.n; r++) {
        pos = raw.find('[', pos + 1);
        for (int c = 0; c < in.n; c++) {
            while (pos < raw.size() && !(isdigit((unsigned char)raw[pos]) || raw[pos] == '-')) pos++;
            size_t start = pos;
            while (pos < raw.size() && (isdigit((unsigned char)raw[pos]) || raw[pos] == '.' || raw[pos] == '-' ||
                                        raw[pos] == 'e' || raw[pos] == 'E' || raw[pos] == '+'))
                pos++;
            in.dist[r][c] = stod(raw.substr(start, pos - start));
        }
    }
    return in;
}

static double pathCost(const vector<int> &p, const vector<vector<double>> &d) {
    double c = 0;
    for (size_t k = 0; k + 1 < p.size(); k++) c += d[p[k]][p[k + 1]];
    return c;
}

static void printRoute(const vector<int> &r) {
    cout << "[";
    for (size_t k = 0; k < r.size(); k++) {
        cout << r[k];
        if (k + 1 < r.size()) cout << ",";
    }
    cout << "]";
}

int main() {
    ostringstream ss;
    ss << cin.rdbuf();
    Input in = parseInput(ss.str());
    int n = in.n;
    auto &d = in.dist;
    int fixedEnd = (in.fixedEnd >= 1 && in.fixedEnd < n) ? in.fixedEnd : -1;
    bool openRoute = in.open;
    string mode = fixedEnd >= 0 ? "fixedEnd" : (openRoute ? "open" : "closed");

    auto t0 = chrono::high_resolution_clock::now();

    if (n <= 1) {
        cout << "{\"route\":[0],\"distance\":0,\"nnRoute\":[0],\"nnDistance\":0,"
             << "\"algorithm\":\"Nearest Neighbor + 2-opt (heuristic)\",\"optimal\":false,\"mode\":\"" << mode
             << "\",\"twoOptMoves\":0,\"timeMs\":0}" << endl;
        return 0;
    }

    // ---- 1. Nearest Neighbor (the fixed end node, if any, is saved for last) ----
    vector<int> path = {0};
    vector<bool> used(n, false);
    used[0] = true;
    if (fixedEnd >= 0) used[fixedEnd] = true;
    int remaining = n - 1 - (fixedEnd >= 0 ? 1 : 0);
    int cur = 0;
    while (remaining-- > 0) {
        int best = -1;
        for (int j = 1; j < n; j++) {
            if (used[j]) continue;
            if (best == -1 || d[cur][j] < d[cur][best]) best = j;
        }
        used[best] = true;
        path.push_back(best);
        cur = best;
    }
    if (fixedEnd >= 0) path.push_back(fixedEnd);
    else if (!openRoute) path.push_back(0);

    vector<int> nnPath = path;
    double nnCost = pathCost(nnPath, d);

    // ---- 2. 2-opt: reverse a segment whenever that shortens the route ----
    int moves = 0;
    if (in.twoOpt && n > 3) {
        int m = (int)path.size();
        bool endFixed = (fixedEnd >= 0) || !openRoute;   // last element can't move
        int lastMovable = endFixed ? m - 2 : m - 1;
        double cost = nnCost;
        bool improved = true;
        int guard = 0;
        while (improved && guard++ < 1000) {
            improved = false;
            for (int i = 1; i < lastMovable; i++) {
                for (int j = i + 1; j <= lastMovable; j++) {
                    vector<int> cand = path;
                    reverse(cand.begin() + i, cand.begin() + j + 1);
                    double c = pathCost(cand, d);
                    if (c + 1e-9 < cost) {
                        path = cand;
                        cost = c;
                        improved = true;
                        moves++;
                    }
                }
            }
        }
    }
    double finalCost = pathCost(path, d);

    auto t1 = chrono::high_resolution_clock::now();
    double ms = chrono::duration<double, milli>(t1 - t0).count();

    cout << fixed << setprecision(4);
    cout << "{\"route\":";
    printRoute(path);
    cout << ",\"distance\":" << finalCost << ",\"nnRoute\":";
    printRoute(nnPath);
    cout << ",\"nnDistance\":" << nnCost;
    cout << ",\"algorithm\":\"" << (in.twoOpt ? "Nearest Neighbor + 2-opt (heuristic)" : "Nearest Neighbor (greedy)")
         << "\",\"optimal\":false,\"mode\":\"" << mode << "\",\"twoOptMoves\":" << moves << ",\"timeMs\":" << ms << "}"
         << endl;
    return 0;
}
