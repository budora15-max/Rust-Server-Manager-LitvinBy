import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ServerProvider } from '@/context/ServerContext';
import { MetricsProvider } from '@/context/MetricsContext';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import Dashboard from '@/pages/Dashboard';
import ServersPage from '@/pages/ServersPage';
import ServerPage from '@/pages/ServerPage';
import Account from '@/pages/Account';

function ProtectedRoute({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function GuestRoute({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <ServerProvider>
        <MetricsProvider>
          <Routes>
          <Route
            path="/login"
            element={
              <GuestRoute>
                <Login />
              </GuestRoute>
            }
          />
          <Route
            path="/register"
            element={
              <GuestRoute>
                <Register />
              </GuestRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/servers"
            element={
              <ProtectedRoute>
                <ServersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/servers/:id"
            element={
              <ProtectedRoute>
                <ServerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/account"
            element={
              <ProtectedRoute>
                <Account />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </MetricsProvider>
      </ServerProvider>
    </AuthProvider>
  );
}
