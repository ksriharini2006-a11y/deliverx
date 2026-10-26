/*
 * greedy.cpp
 * -----------------------------------------------------------------------
 * Nearest Neighbor heuristic for TSP — used ONLY for comparison against
 * the exact DP+Bitmask solution in tsp.cpp. This is NOT the core DAA
 * algorithm of the project; it exists to show students/examiners the
 * classic "fast but not always optimal" trade-off.
 *
 * IDEA:
 *   Starting from the depot, repeatedly jump to the nearest city that
 *   hasn't been visited yet. Stop when every city has been visited,
 *   then return to the depot.
 *
 * WHY IT CAN BE WRONG:
 *   Greedily taking the closest next step can strand you far from
 *   several remaining cities later in the route, forcing a long "return
 *   trip" that an optimal plan would have avoided by ordering things
 *   differently from the start. This is the classic greedy-algorithm
 *   pitfall: locally optimal choices don't guarantee a globally optimal
 *   result (unlike DP+Bitmask, which is proven optimal).
 *
 * COMPLEXITY:
 *   Time:  O(n^2)   (n steps, each scanning up to n cities for the nearest)
 *   Space: O(n)
 *   Dramatically cheaper than O(n^2 * 2^n), but no optimality guarantee.
 *
 * INPUT / OUTPUT: identical JSON contract to tsp.cpp, so the Node
 * backend can call either binary interchangeably.
 *
 *   echo '{"n":4,"dist":[[0,10,15,20],[10,0,35,25],[15,35,0,30],[20,25,30,0]]}' | ./greedy
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

struct JsonInput {
    int n;
    vector<vector<double>> dist;
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
    while (i < raw.size() && isdigit((unsigned char)raw[i])) numBuf += raw[i++];
    out.n = stoi(numBuf);

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

int main() {
    std::ostringstream ss;
    ss << cin.rdbuf();
    string raw = ss.str();

    JsonInput input = parseInput(raw);
    int n = input.n;
    auto &dist = input.dist;

    auto t0 = chrono::high_resolution_clock::now();

    vector<bool> visited(n, false);
    vector<int> route;
    route.push_back(0);
    visited[0] = true;
    double total = 0.0;
    int cur = 0;

    for (int step = 1; step < n; step++) {
        int nextCity = -1;
        double best = 1e18;
        for (int j = 0; j < n; j++) {
            if (visited[j]) continue;
            if (dist[cur][j] < best) {
                best = dist[cur][j];
                nextCity = j;
            }
        }
        visited[nextCity] = true;
        route.push_back(nextCity);
        total += best;
        cur = nextCity;
    }
    total += dist[cur][0]; // return to depot
    route.push_back(0);

    auto t1 = chrono::high_resolution_clock::now();
    double ms = chrono::duration<double, milli>(t1 - t0).count();

    cout << fixed << setprecision(2);
    cout << "{";
    cout << "\"route\":[";
    for (size_t k = 0; k < route.size(); k++) {
        cout << route[k];
        if (k + 1 < route.size()) cout << ",";
    }
    cout << "],";
    cout << "\"distance\":" << total << ",";
    cout << "\"algorithm\":\"Nearest Neighbor (Greedy)\",";
    cout << "\"optimal\":false,";
    cout << "\"timeMs\":" << setprecision(4) << ms;
    cout << "}" << endl;

    return 0;
}
