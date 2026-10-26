# DeliverX: Smart Delivery Agent Route Optimizer

A full-stack hyperlocal delivery planner. Pick a small area (for example a
neighbourhood), set a pickup point, add real delivery addresses, and the app
finds the best delivery order using **real road distances**.

**DAA core:** Travelling Salesman Problem solved exactly with **Dynamic
Programming + Bitmasking (Held-Karp)** in C++ (`dp[mask][i]`, time O(n²·2ⁿ),
space O(n·2ⁿ)). For too many stops it falls back to **Nearest Neighbor + 2-opt**
(a heuristic, clearly labelled as not guaranteed optimal).

**Nothing is hard-coded.** There is no built-in city, area, hub or sample
delivery list. Every place comes from address search or a pin you place.

## Architecture

```
React + Vite + Leaflet  ->  Node/Express API  ->  C++ solvers (tsp, heuristic, greedy, multi_tsp)
   (OpenStreetMap map)       |-> Nominatim  (address search / reverse lookup)
                             |-> OSRM       (road distance + time matrix, road geometry)
```

## Run it (exact commands)

Needs Node.js 18 or newer and a C++ compiler (`g++` or Apple clang). Internet access is needed for maps, address search and routing.

**1. Compile the C++ solvers (once)**
```
cd cpp
g++ -O2 -std=c++17 -o tsp tsp.cpp
g++ -O2 -std=c++17 -o heuristic heuristic.cpp
g++ -O2 -std=c++17 -o greedy greedy.cpp
g++ -O2 -std=c++17 -o multi_tsp multi_tsp.cpp
cd ..
```
(On Windows, name the outputs `tsp.exe`, `heuristic.exe`, `greedy.exe`, `multi_tsp.exe`.)

**2. Backend** (keep running)
```
cd backend
npm install
GEOCODER_CONTACT=your-email@example.com PORT=5050 npm start
```
`PORT=5050` avoids macOS AirPlay on port 5000. `GEOCODER_CONTACT` is put in the User-Agent, as the Nominatim usage policy asks apps to identify themselves.

**3. Frontend** (new terminal)
```
cd frontend
npm install
npm run dev
```
Open the printed address (usually http://localhost:5173) and log in with any username and a password of 4 or more characters.

**Tests (optional)**
```
cd backend
npm test
```
These use stand-in map servers so they run offline. They prove the logic, not the live services.

## Configuration (all optional, all on the backend)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 5000 | Backend port. If you change it, also change `API_BASE` in `frontend/src/services/api.js` |
| `GEOCODER_CONTACT` | none | Your email, sent in the User-Agent for Nominatim |
| `OSRM_BASE_URL` | https://router.project-osrm.org | Road routing engine |
| `NOMINATIM_BASE_URL` | https://nominatim.openstreetmap.org | Address search |
| `GEOCODER_COUNTRY_CODES` | in | Restrict search to these countries |
| `EXACT_MAX_NODES` | 16 | Use exact DP up to this many points (pickup + 15 stops) |
| `HTTP_TIMEOUT_MS` | 15000 | Timeout per outgoing request |

No API key is needed for the default free services. If you later use a keyed
provider, put the key in a backend environment variable only; never in frontend code.

**Public-server etiquette.** The free OSRM demo and Nominatim servers are for light, non-commercial use (about 1 request per second). The backend throttles and caches requests. Nominatim asks apps not to use instant search-as-you-type, so search runs on Search/Enter by default (an optional checkbox adds a delayed auto-search). For heavy or commercial use, run your own OSRM/Nominatim or use a commercial provider.

## How to use the Delivery Planner

1. **Delivery area:** type state, city and locality, click *Find area*, choose a result, and set the zone radius.
2. **Pickup point:** search the warehouse/shop address, or click its spot on the map and choose *Set as pickup point*.
3. **Delivery addresses:** search house number + street, apartment, shop, landmark, road or PIN code. Only places inside the zone can be added. If an address is not found, click the exact spot on the map and drag the pin.
4. **Route options:** *Return to pickup* or *Open route* (finish at the last stop); minimise road distance or travel time.
5. **Find best delivery order:** see the road route on the map, the entered order vs the optimized order, the leg-by-leg table, the Standard vs EV cost, and which algorithm was used and why.
6. **Delivery Agent:** *Start delivery*, then *Navigate to next stop*, *Mark as delivered*, *Skip stop*, *Recalculate remaining route*, *Finish delivery*.

Every location is labelled: **Verified address** (building/shop/house level match), **Street-level**, **Area-level (approx.)**, or **Manual pin**. A geocoded pin that you drag becomes a manual pin.

## Test scenario (Vandalur, Chennai)

Run these in the app and check each step. I could not run live searches while building, so confirm each result on the map.

1. Area: state `Tamil Nadu`, city `Chennai`, locality `Vandalur` → *Find area* → *Use this area*. Set the radius to 7 km.
2. Pickup: search `Vandalur railway station` → *Set as pickup*.
3. Stops: search these landmarks one by one and *Add as stop*: `Arignar Anna Zoological Park Vandalur`, `Kilambakkam bus terminus`, `Guduvanchery railway station`, `Urapakkam railway station`, `Perungalathur railway station`. Check each pin sits where you expect.
4. A shop: search a shop or restaurant name you know in Vandalur or Kelambakkam. If it is not found, drop a pin on it.
5. A residential address: type the address in the search box. If it is not found, click the spot, drag the pin, type the address in the address box and save (it is labelled *Manual pin*).
6. Correct a pin: *Move pin* on any stop, then drag it.
7. *Find best delivery order*. Compare *Entered order* and *Optimized* in the table.
8. Switch the policy to *Open route* and recalculate.
9. Open *Edit cost assumptions*, change a rate, and switch between *Standard* and *EV*.
10. *Start delivery (agent mode)*, mark one stop delivered, skip one, *Recalculate remaining route*, finish.
11. Invalid input: search `zzzzqq nothing`; the app shows "No matching place found". Stop the backend's internet or point `OSRM_BASE_URL` at a dead address; the app shows a routing error and does not fall back to straight-line distance.

## What was added in this version

- Real address search and reverse lookup (Nominatim), with verified/approximate/manual labels.
- Road-network distance and time matrices, and road-following route lines (OSRM). No silent straight-line fallback.
- Route policies: open route and return-to-pickup.
- Optimization on road distance or road time. Exact Held-Karp DP up to 15 stops (plus pickup); Nearest Neighbor + 2-opt beyond that.
- Original vs optimized order comparison, with Nearest Neighbor and 2-opt shown too.
- Delivery-agent mode (next stop, delivered, skip, recalculate, finish, external navigation link).
- Standard and EV cost modes with configurable rates and visible assumptions.
- Validation: coordinates, duplicates, zone, suspicious distance, every stop exactly once, start/finish by policy, totals from route legs.
- **Removed:** all hard-coded areas and demo data (T Nagar, Chennai and Vandalur presets, the "Load Demo Route" buttons, the old Area Planner and its `/api/areas` endpoint).

## Files created or changed

Backend: `services/` (config, errors, httpClient, geocodeService, routingService, tspService, validationService, planService, costService), `controllers/` (plan, geocode, cost, status), `routes/` (plan, geocode, cost, status), `data/store.js` (now empty at start), `utils/runCpp.js`, `server.js`, `test/`.
C++: `cpp/tsp.cpp` (open route, fixed end, directed costs), `cpp/heuristic.cpp` (Nearest Neighbor + 2-opt), `Makefile`.
Frontend: `pages/DeliveryPlanner.jsx`, `pages/DeliveryAgent.jsx`, `components/PlanMap.jsx`, `PlaceSearch.jsx`, `VerificationBadge.jsx`, `CostPanel.jsx`, `hooks/PlanContext.jsx`, `services/agentLogic.js`, `services/costConfig.js`, plus edits to `App.jsx`, `Sidebar.jsx`, `api.js`, `Dashboard`, `Locations`, `MultiAgent`, `AppDataContext`, `index.css`.

The older pages (Plan Route, Multi-Agent Routes, Live Tracking, Analytics) still work. They use straight-line (Haversine) distances and the in-memory store. The Delivery Planner can copy its places there with *Split between several agents*.

## How the DAA algorithm picks the route

1. The road matrix gives `dist[i][j]`, the road cost from point i to point j (it can differ from j to i because of one-way streets).
2. Index 0 is the start (pickup). A bitmask records which stops are visited.
3. `dp[mask][i]` = cheapest way to start at 0, visit exactly the stops in `mask`, and stand at stop `i`.
4. `dp[mask][i] = min over j in mask (dp[mask without i][j] + dist[j][i])`, base `dp[{0}][0] = 0`.
5. Return-to-pickup answer: `min over i (dp[FULL][i] + dist[i][0])`. Open route: `min over i dp[FULL][i]`.
6. A `parent[mask][i]` table is walked backwards to rebuild the order.
7. It checks every subset once, so the result is the best possible order. Time O(n²·2ⁿ), space O(n·2ⁿ), which is why exact search stops at 16 points. Beyond that, Nearest Neighbor builds a tour and 2-opt keeps reversing segments while that shortens it. That is fast but may miss the true optimum, and the app says so.

## Known limitations

- Individual house numbers are often missing from OpenStreetMap, especially in smaller localities. Use a manual pin and type the address; the app labels it *Manual pin*.
- Search and routing depend on free public servers that can be slow, rate-limited or down. The app shows the reason and never invents results.
- Travel times are free-flow estimates from road speeds. They are not live traffic and not guaranteed arrival times.
- There is no live GPS. The agent's position is the pickup, then the last stop marked delivered. Turn-by-turn navigation opens in Google Maps or OpenStreetMap.
- Priority, time windows and package details are stored and shown to the agent, but the optimizer does not enforce them.
- The zone is a circle around the pickup (no drawn polygon).
- Data is in browser storage and server memory; there is no database or real authentication (login is a demo gate).
- The multi-agent tool clusters stops with a heuristic; each agent's route is then solved exactly.
