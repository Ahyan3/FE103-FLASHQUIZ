// src/services/auth.ts
// ============================================================
// Authentication Service
// ------------------------------------------------------------
// This module handles all authentication-related operations
// for the FlashQuiz app. It communicates with the Django
// backend API and manages local session state using
// localStorage.
//
// Responsibilities:
//   - User signup and login (JWT-based)
//   - Logout and session cleanup
//   - Storing and retrieving the current user from localStorage
//   - Providing authenticated fetch helpers for other services
//   - Tracking the last sync timestamp for offline/online sync
//
// Token Strategy:
//   - The backend returns a JWT access token on login
//   - The token is stored in localStorage under ACCESS_TOKEN_KEY
//   - All protected API requests attach the token as a
//     Bearer token in the Authorization header
//   - CSRF tokens are also supported for cookie-based endpoints
// ============================================================

import type { User } from "../types/auth";

// ============================================================
// LocalStorage Keys
// ------------------------------------------------------------
// Centralizing these as constants prevents typos and makes
// it easy to rename them in one place if needed.
// ============================================================

/** Key for storing the logged-in user's profile object */
const LOGGED_IN_KEY = "loggedInUser";

/** Key for storing the JWT access token returned on login */
const ACCESS_TOKEN_KEY = "accessToken";

/**
 * Key for storing the ISO timestamp of the last successful
 * data sync between the local IndexedDB and the backend.
 * Used by the sync engine to request only changed records.
 */
const LAST_SYNC_KEY = "lastSync";

// ============================================================
// API Base URL
// ------------------------------------------------------------
// Reads from the Vite environment variable VITE_API_URL so
// the URL can differ between development and production
// without changing code. Falls back to localhost for local dev.
//
// To set in production, add to your .env file:
//   VITE_API_URL=https://yourapi.com/api
// ============================================================
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

// ============================================================
// HELPER: request
// ------------------------------------------------------------
// A low-level fetch wrapper used internally by signup and login.
// It handles:
//   - Setting Content-Type to JSON by default
//   - Injecting CSRF tokens from the page's meta tags
//   - Including cookies with every request (credentials: include)
//   - Parsing error responses into readable Error messages
//   - Logging errors to the console for debugging
//
// NOTE: This helper is for unauthenticated requests (signup,
// login). For authenticated requests, use authFetch() instead,
// which adds the Bearer token automatically.
// ============================================================
const request = async (url: string, options: RequestInit = {}) => {
  // Start with JSON content type, then merge any caller-provided headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  // --- CSRF Token Injection ---
  // Django's CSRF protection requires this header for non-GET requests.
  // The token is embedded in the page as a <meta name="csrf-token"> tag
  // by the Django template engine. If it's present, we add it to every
  // request so the backend accepts the request without a 403 error.
  const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content;
  if (csrfToken) {
    headers["X-CSRFToken"] = csrfToken;
  }

  const res = await fetch(url, {
    headers,
    credentials: "include", // Send cookies (e.g., session cookies) with the request
    ...options,             // Merge caller options (method, body, etc.)
  });

  // --- Error Handling ---
  // If the response status is not 2xx, parse the error body and throw.
  // We try to read a JSON error body first (Django usually returns
  // {"detail": "..."} for errors). If parsing fails, fall back to
  // the HTTP status text (e.g., "Unauthorized").
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error("API Error:", errorData); // Log full error for debugging
    throw new Error(errorData.detail || JSON.stringify(errorData) || res.statusText);
  }

  // Parse and return the JSON response body on success
  return res.json();
};

// ============================================================
// SIGNUP
// ------------------------------------------------------------
// Creates a new user account on the backend, then automatically
// logs them in so they don't have to enter their credentials
// again immediately after registering.
//
// Flow:
//   1. POST /signup/ with email, username, password
//   2. Call login() to get a JWT token and store session data
//   3. Return the raw signup response data
//
// The auto-login call ensures the user lands on the dashboard
// immediately after signup rather than being sent to login.
// ============================================================
export const signup = async (email: string, username: string, password: string) => {
  const data = await request(`${API_URL}/signup/`, {
    method: "POST",
    body: JSON.stringify({ email, username, password }),
  });

  // Automatically log in after successful signup
  // This populates localStorage with the user and token
  await login(email, password);
  return data;
};

// ============================================================
// LOGIN
// ------------------------------------------------------------
// Authenticates the user against the backend and persists
// the session data to localStorage.
//
// Flow:
//   1. POST /login/ with email or username + password
//   2. Backend returns { user: {...}, access: "jwt_token..." }
//   3. User object and JWT token are stored in localStorage
//   4. Returns the user object for immediate use by the caller
//
// The emailOrUsername parameter supports both formats because
// the backend's LoginSerializer accepts either.
// ============================================================
export const login = async (emailOrUsername: string, password: string) => {
  const data = await request(`${API_URL}/login/`, {
    method: "POST",
    body: JSON.stringify({ email_or_username: emailOrUsername, password }),
  });

  // Persist the user profile for getCurrentUser() calls
  localStorage.setItem(LOGGED_IN_KEY, JSON.stringify(data.user));

  // Persist the JWT token for use in authenticated requests
  localStorage.setItem(ACCESS_TOKEN_KEY, data.access);

  return data.user as User;
};

// ============================================================
// LOGOUT
// ------------------------------------------------------------
// Clears all session data from localStorage, effectively
// ending the user's session on this device.
//
// Note: This does NOT invalidate the JWT token on the server.
// JWT tokens are stateless — the token remains technically
// valid until it expires. For full invalidation, the backend
// would need a token blacklist (not currently implemented).
//
// We also clear the lastSync timestamp so that on next login,
// the sync engine performs a full sync rather than a partial one.
// ============================================================
export const logout = () => {
  localStorage.removeItem(LOGGED_IN_KEY);
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(LAST_SYNC_KEY); // Reset sync state on logout
};

// ============================================================
// GET CURRENT USER
// ------------------------------------------------------------
// Reads the logged-in user's profile from localStorage.
// Returns null if no user is logged in (token missing or
// the user has never logged in on this device).
//
// The return type excludes "password" since we never store
// the password locally — only the backend handles that.
//
// Used by components to check auth state and display the
// user's name/email without making a network request.
// ============================================================
export const getCurrentUser = (): Omit<User, "password"> | null => {
  const data = localStorage.getItem(LOGGED_IN_KEY);
  return data ? JSON.parse(data) : null;
};

// ============================================================
// AUTH HEADERS HELPER
// ------------------------------------------------------------
// Returns a headers object with the Authorization Bearer token
// pre-filled. Used by services that build their own fetch()
// calls and need to manually attach auth headers.
//
// Returns plain Content-Type if no token is stored (e.g.,
// the user is logged out) — the API will reject the request
// with a 401, which the caller should handle.
// ============================================================
export const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Only add Authorization if we actually have a token
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
};

// ============================================================
// AUTH FETCH HELPER
// ------------------------------------------------------------
// The primary helper for making authenticated API requests.
// Automatically attaches the stored JWT token to every request
// and handles both JSON and FormData bodies correctly.
//
// Key differences from the internal request() helper:
//   - Requires an active token (throws if not logged in)
//   - Uses the Headers class for type-safe header management
//   - Does NOT set Content-Type for FormData requests —
//     the browser must set it automatically with the boundary
//     parameter, which is required for multipart uploads to work
//   - Does NOT send cookies (no credentials: "include") since
//     JWT is handled via the Authorization header instead
//
// Used by: sync.ts, sharing.ts, progress.ts, and any other
// service that needs to call a protected backend endpoint.
// ============================================================
export const authFetch = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);

  // Guard: reject immediately if no token is present
  // This prevents silent failures where requests go out without auth
  if (!token) throw new Error("Not authenticated");

  // Use the Headers class for safe mutation of existing headers
  const headers = new Headers(options.headers);

  // Attach the JWT token as a Bearer token in the Authorization header
  headers.set("Authorization", `Bearer ${token}`);

  // --- Content-Type Handling ---
  // For regular JSON requests, explicitly set Content-Type.
  // For FormData (file uploads), we intentionally skip this —
  // the browser will set "multipart/form-data; boundary=..." automatically,
  // and overriding it would break the multipart format.
  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, {
    ...options, // Merge all caller options (method, body, etc.)
    headers,    // Use our modified headers (with auth token)
  });

  // --- Error Handling ---
  // Parse the error body if the response is not successful.
  // Django REST Framework returns errors as:
  //   { "detail": "..." }  for generic errors
  //   { "error": "..." }   for custom view errors
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.error || res.statusText);
  }

  // Return the parsed JSON response on success
  return res.json();
};

// ============================================================
// SYNC TIMESTAMP HELPERS
// ------------------------------------------------------------
// These two simple helpers read and write the timestamp of
// the last successful data sync. The sync engine uses this
// to request only records that changed after the last sync,
// reducing data transfer and speeding up syncs.
//
// Format: ISO 8601 string e.g. "2026-03-31T12:00:00.000Z"
// ============================================================

/**
 * Returns the ISO timestamp of the last successful sync,
 * or null if the user has never synced (e.g., first login).
 * A null value tells the sync engine to do a full sync.
 */
export const getLastSync = (): string | null => {
  return localStorage.getItem(LAST_SYNC_KEY);
};

/**
 * Stores the timestamp of the most recent successful sync.
 * Called by the sync engine after a sync completes so that
 * the next sync can request only the delta (changed records).
 */
export const setLastSync = (timestamp: string) => {
  localStorage.setItem(LAST_SYNC_KEY, timestamp);
};