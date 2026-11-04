import React, { useEffect } from 'react';
import { useAuth } from './AuthContext.js';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

// Protect child screens and redirect unauthenticated users to the login screen.
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, loading } = useAuth();

  // Redirect to the login screen when session validation completes without a user.
  useEffect(() => {
    if (!loading && !user) {
      window.history.pushState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [loading, user]);

  // Render nothing while authentication state is loading or invalid.
  if (loading || !user) {
    return null;
  }

  return <>{children}</>;
};
