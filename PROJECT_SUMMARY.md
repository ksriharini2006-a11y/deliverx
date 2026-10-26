# DeliverX: Smart Delivery Agent Route Optimizer (DAA project): full summary

Paste this into a new chat to continue. Owner: Sri Harini (VIT Chennai, 3rd-year B.Tech CSE). Demo is to her professor.

## Goal
College DAA project. The graded core is the **Travelling Salesman Problem solved exactly with Dynamic Programming + Bitmasking (Held-Karp) in C++**: `dp[mask][i]`, time O(n^2 * 2^n), space O(n * 2^n), with route reconstruction via a parent table (index 0 = depot/start). Nearest Neighbor greedy is included only as a comparison. The EV cost estimate (7 km/kWh, Rs 12/kWh) is an extra feature and never affects routing.

## Architecture
React + Vite + Leaflet/OpenStreetMap (dark theme) -> Node/Express API (port **5050**, because macOS AirPlay uses 5000) -> C++ binaries (`tsp`, `greedy`, `multi_tsp`) via child_process, JSON over stdin/stdout. In-memory data, no database. Frontend API base: `http://localhost:5050/api` (in `frontend/src/services/api.js`). Demo login: any username + password of 4 or more characters (frontend-only, localStorage).

## Features built (in order)
1. Full TSP app: C++ DP+bitmask, greedy, Express API, React UI, Leaflet map, route/ETA/legs, EV estimate, deliveries with live statuses.
2. Compile fix for Apple clang: explicit std headers instead of `bits/stdc++.h`.
3. Dark theme + login page. Map tiles switched to plain OSM with a CSS invert filter (CartoDB needed an API key).
4. **Multi-agent routing (mTSP)** for 1-6 agents: cluster-first (farthest-seed balanced clustering, a heuristic), then exact DP per agent. Shows total distance and makespan (longest agent route).
5. **Live tracking**: all agents move at the same time (colour-coded trucks); order statuses (Pending -> On the way -> Delivered) update live while tracking.
6. **Area Planner**: shows the distance from the hub (or from any chosen start place) to every place, nearest first, with addresses. Shortest round trip with leg-by-leg distances, and DP vs Nearest Neighbor comparison. "Start from" any place works by reordering so the chosen start is index 0 (C++ unchanged). Pairwise distance matrix.
   - Presets: **Vandalur** (hub + 7 localities: Zoo, Kilambakkam, Urapakkam, Guduvanchery, Perungalathur, Peerkankaranai, Mannivakkam) and **Chennai city** demo (T Nagar hub + 9 stops).
7. **Any place, nothing hard-coded** (latest): search any place/address (Nominatim, from the browser) or click the map -> **Make Hub** (`POST /api/locations/new-area`) -> **Add Stop**; remove stops with an X; cap of 17 stops + hub.
8. **Street-level mode (single neighbourhood, e.g. KK Nagar)**: after Make Hub, **Find Nearby** lists real named shops/restaurants/clinics/banks within 500 m-2 km from OpenStreetMap (Overpass); tick and add many as stops at once. Houses are mostly not in OSM, so add a customer's house by searching its address or clicking the map. Distances under 1 km show in metres.

## Key verified numbers (for the demo)
- Vandalur hub distances: Zoo 1.35 km, Perungalathur 1.8, Mannivakkam 1.8, Peerkankaranai 2.55, Urapakkam 3.5, Kilambakkam 3.68, Guduvanchery 5.61. Optimal tour 18.74 km (Nearest Neighbor ties at 18.74). Starting from Perungalathur: nearest is Peerkankaranai at 0.86 km, same 18.74 km loop.
- Chennai demo: DP 62.43 km vs Nearest Neighbor 83.03 km (DP saves 20.6 km). 3 agents: total 81.83, makespan 46.88. EV for 42 km: 6 kWh, Rs 72.
- Vandalur with 3 agents: 11.76 / 5.21 / 10.66 km (total 27.64, makespan 11.76).

## Honest caveats (say these to the sir)
- Distances are straight-line (Haversine), not road distance. OSRM was in the spec but is not implemented.
- A round trip through the same places is the same loop wherever you start, so the total distance does not change with the start; only the order and the nearest-first ranking change. A one-way (no-return) option would need a small C++ flag (not built).
- Vandalur preset coordinates are approximate, locality-level.
- Nearest Neighbor can tie DP on small layouts; use the Chennai demo to show the gap.
- mTSP clustering is a heuristic; DP per agent is optimal.
- Nominatim may miss small localities (use map click). Page tests mocked the Leaflet map.

## Run steps
```
cd cpp
g++ -O2 -std=c++17 -o tsp tsp.cpp
g++ -O2 -std=c++17 -o greedy greedy.cpp
g++ -O2 -std=c++17 -o multi_tsp multi_tsp.cpp
cd ../backend && npm install && PORT=5050 npm start
# new terminal
cd frontend && npm install && npm run dev      # open http://localhost:5173
```
Then log in -> Area Planner.

## Where things are
- `cpp/` tsp.cpp, greedy.cpp, multi_tsp.cpp, Makefile
- `backend/` server.js, data/store.js (areas + in-memory data), utils/ (distance.js, runCpp.js), controllers/ (location, route, ev, delivery, area), routes/
- `frontend/src/` pages/ (Login, Dashboard, AreaPlanner, PlanRoute, Locations, MultiAgent, LiveTracking, Analytics, Settings), components/ (MapView, PlaceFinder, Sidebar, ...), hooks/ (AppDataContext, AuthContext), services/api.js
- API: GET /api/areas, POST /api/areas/:id/load, POST /api/locations/new-area, POST /api/route/{optimize,greedy,compare,multi-agent,distances} (optional `startId`), POST /api/ev/calculate, GET/PATCH /api/deliveries.

## Working style preferences
Wants complete, copy-paste-ready files (zip she can open in VS Code), exact terminal steps, concise informal replies.


---
## UPDATE (latest): hyperlocal, real-address, road-network version
- Spec from the professor: real geocoded addresses, real road distances, zone, open/return route, delivery-agent mode, standard/EV cost modes, no fake data.
- Built: Delivery Planner (area -> pickup -> addresses -> optimize), Delivery Agent page, PlanMap, CostPanel, PlanContext, agentLogic.
- Backend: Nominatim geocoding (throttled, cached), OSRM table/route (no straight-line fallback), validation, tspService (exact DP up to 16 points else NN+2-opt), plan/recalculate/cost/status endpoints.
- C++: tsp.cpp supports open + fixedEnd on directed costs; heuristic.cpp = NN + 2-opt.
- REMOVED all hard-coded data (T Nagar, Chennai, Vandalur presets, Load Demo buttons, old Area Planner). The old Vandalur/Chennai numbers above are from the earlier straight-line version.
- Tests: backend node --test (22 pass, offline stand-in servers); frontend flow test with stand-in services passed. Live Nominatim/OSRM could NOT be reached from my build environment, so real-service behaviour is untested by me.
