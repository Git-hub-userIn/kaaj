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
