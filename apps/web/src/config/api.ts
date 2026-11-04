/**
 * Centralized API and environment configuration.
 * Configured via Vite environment variable `VITE_API_URL`.
 * Defaults to '/api' for Vite's local dev reverse proxy.
 */

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string)?.replace(/\/$/, '') || '/api';

export function getAuthToken(): string {
  if (typeof window !== 'undefined') {
    const stored =
      window.localStorage.getItem('kaaj_auth_token') || window.sessionStorage.getItem('kaaj_auth_token');
    if (stored) return stored.startsWith('Bearer ') ? stored : `Bearer ${stored}`;
  }
  return 'Bearer kaaj-local-dev-token';
}

export function getUserId(): string {
  if (typeof window !== 'undefined') {
    const stored =
      window.localStorage.getItem('kaaj_user_id') || window.sessionStorage.getItem('kaaj_user_id');
    if (stored) return stored;
    const token = getAuthToken().replace('Bearer ', '').trim();
    if (token.startsWith('user:')) return token.slice(5);
    if (token.startsWith('token-user-')) return token.replace('token-', '');
  }
  return 'dev-owner-user';
}

export function getWsUrl(): string {
  if (typeof window !== 'undefined') {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return `ws://${window.location.hostname}:3001/sync/ws`;
    }
    const base = API_BASE_URL.startsWith('http')
      ? API_BASE_URL.replace(/^http/, 'ws')
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
    return `${base}/sync/ws`;
  }
  return 'ws://localhost:3001/sync/ws';
}

export const AUTH_TOKEN = 'Bearer kaaj-local-dev-token';

export function getAuthHeaders(): HeadersInit {
  return {
    Authorization: getAuthToken(),
    'Content-Type': 'application/json',
  };
}

export const DEFAULT_HEADERS: HeadersInit = {
  Authorization: AUTH_TOKEN,
  'Content-Type': 'application/json',
};

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) {
    try {
      listener();
    } catch (err) {
      console.error('Error in unauthorized listener:', err);
    }
  }
}

/**
 * Shared fetch wrapper for all API operations.
 * Sends session cookies and handles 401 Unauthorized responses.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const options: RequestInit = {
    ...init,
    credentials: init?.credentials ?? 'include',
  };

  const response = await fetch(input, options);

  const urlStr =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.toString()
      : (input as Request).url || '';

  // Intercept 401 Unauthorized, notify auth context and navigate to /login (skipping /auth/me)
  if (response.status === 401 && !urlStr.includes('/auth/me')) {
    notifyUnauthorized();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.history.pushState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }

  return response;
}
