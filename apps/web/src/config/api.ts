/**
 * Centralized API and environment configuration.
 * Configured via Vite environment variable `VITE_API_URL`.
 * Defaults to '/api' for Vite's local dev reverse proxy.
 */

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string)?.replace(/\/$/, '') || '/api';

export const AUTH_TOKEN = 'Bearer kaaj-local-dev-token';

export const DEFAULT_HEADERS: HeadersInit = {
  Authorization: AUTH_TOKEN,
  'Content-Type': 'application/json',
};
