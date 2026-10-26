import React from "react";
import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import PlanRoute from "./pages/PlanRoute";
import DeliveryPlanner from "./pages/DeliveryPlanner";
import DeliveryAgent from "./pages/DeliveryAgent";
import Locations from "./pages/Locations";
import MultiAgent from "./pages/MultiAgent";
import LiveTracking from "./pages/LiveTracking";
import Analytics from "./pages/Analytics";
import Settings from "./pages/Settings";
import Login from "./pages/Login";
import { AppDataProvider } from "./hooks/AppDataContext";
import { PlanProvider } from "./hooks/PlanContext";
import { AuthProvider, useAuth } from "./hooks/AuthContext";

// Wraps every page except /login. Redirects to /login if not signed in,
// and remembers where the user was headed so login sends them back there.
function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <AppDataProvider>
      <PlanProvider>
      <div className="app-shell">
        <Navbar />
        <div className="body-row">
          <Sidebar />
          <div className="main-content">
            <Outlet />
          </div>
        </div>
      </div>
      </PlanProvider>
    </AppDataProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={<RequireAuth />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/delivery-planner" element={<DeliveryPlanner />} />
          <Route path="/delivery-agent" element={<DeliveryAgent />} />
          <Route path="/plan-route" element={<PlanRoute />} />
          <Route path="/multi-agent" element={<MultiAgent />} />
          <Route path="/locations" element={<Locations />} />
          <Route path="/live-tracking" element={<LiveTracking />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
