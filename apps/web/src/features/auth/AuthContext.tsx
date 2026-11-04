import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getAuthHeaders, onUnauthorized , apiFetch } from '../../config/api.js';

export interface User {
  id: string;
  email: string;
  name?: string | null;
  picture?: string | null;
}

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Provide authentication state and actions to child components.
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch the current user session from the server on mount.
  useEffect(() => {
    let isMounted = true;
    const isTestMode = (import.meta.env as any).APP_MODE === 'test';

    const checkSession = async () => {
      try {
        const res = await fetch('/auth/me', {
          method: 'GET',
          credentials: 'include',
        });

        if (res.ok) {
          const data = (await res.json()) as User;
          if (isMounted) {
            setUser(data);
          }
        } else {
          // Clear user on 401 Unauthorized or any other failure.
          if (isMounted) {
            setUser(null);
          }
        }
      } catch {
        if (isMounted) {
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    checkSession();

    return () => {
      isMounted = false;
    };
  }, []);

  // Subscribe to global unauthorized responses to clear user state.
  useEffect(() => {
    return onUnauthorized(() => {
      setUser(null);
    });
  }, []);

  // End the user session on the server and navigate to the login screen.
  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
      });
    } catch (err) {
      console.error('Failed to log out cleanly:', err);
    } finally {
      setUser(null);
      window.history.pushState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, []);

  const value = {
    user,
    loading,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Access authentication state from the nearest AuthProvider.
export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
