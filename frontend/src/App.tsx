import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { getCurrentUser } from "./services/auth";
import { startBackgroundSync, stopBackgroundSync } from "./services/sync";
import Login from "./pages/login";
import Signup from "./pages/signup";
import Dashboard from "./pages/home";
import SetDetail from "./pages/set-detail";
import StudyMode from "./pages/StudyMode";
import QuizMode from "./pages/QuizMode";
import SharedSetView from "./pages/SharedSetView";

// Protected Route Component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const user = getCurrentUser();
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
};

// Public Route Component (redirects to home if already logged in)
const PublicRoute = ({ children }: { children: React.ReactNode }) => {
  const user = getCurrentUser();
  
  if (user) {
    return <Navigate to="/" replace />;
  }
  
  return <>{children}</>;
};

function App() {
  useEffect(() => {
    // Only start background sync if user is logged in
    const user = getCurrentUser();
    if (!user) return;

    // Start background sync every 10 minutes
    const syncIntervalId = startBackgroundSync(10);
    console.log("Background sync started (every 10 minutes)");

    // Cleanup: stop background sync when component unmounts
    return () => {
      stopBackgroundSync(syncIntervalId);
      console.log("Background sync stopped");
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route
          path="/login"
          element={
            <PublicRoute>
              <Login />
            </PublicRoute>
          }
        />
        <Route
          path="/signup"
          element={
            <PublicRoute>
              <Signup />
            </PublicRoute>
          }
        />

        {/* Shared Set View - Public but can work with auth */}
        <Route path="/share/:shareCode" element={<SharedSetView />} />

        {/* Protected Routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/set/:setId"
          element={
            <ProtectedRoute>
              <SetDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/study"
          element={
            <ProtectedRoute>
              <StudyMode />
            </ProtectedRoute>
          }
        />
        <Route
          path="/quiz"
          element={
            <ProtectedRoute>
              <QuizMode />
            </ProtectedRoute>
          }
        />

        {/* Catch all - redirect to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;