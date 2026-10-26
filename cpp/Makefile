CXX = g++
CXXFLAGS = -O2 -std=c++17

all: tsp greedy multi_tsp heuristic

tsp: tsp.cpp
	$(CXX) $(CXXFLAGS) -o tsp tsp.cpp

greedy: greedy.cpp
	$(CXX) $(CXXFLAGS) -o greedy greedy.cpp

heuristic: heuristic.cpp
	$(CXX) $(CXXFLAGS) -o heuristic heuristic.cpp

multi_tsp: multi_tsp.cpp
	$(CXX) $(CXXFLAGS) -o multi_tsp multi_tsp.cpp

# On Windows (no make), just run these two lines directly:
#   g++ -O2 -std=c++17 -o tsp.exe tsp.cpp
#   g++ -O2 -std=c++17 -o greedy.exe greedy.cpp
#   g++ -O2 -std=c++17 -o multi_tsp.exe multi_tsp.cpp
#   g++ -O2 -std=c++17 -o heuristic.exe heuristic.cpp

clean:
	rm -f tsp greedy multi_tsp heuristic
