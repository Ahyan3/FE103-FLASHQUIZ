// src/services/auth.ts
import type { User } from "../types/auth";

const LOGGED_IN_KEY = "loggedInUser";
const ACCESS_TOKEN_KEY = "accessToken";
const LAST_SYNC_KEY = "lastSync";

// Base URL of your Django API
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

// ------------------- HELPER: REQUEST -------------------
const request = async (url: string, options: RequestInit = {}) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  // Add CSRF token if available
  const csrfToken = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content;
  if (csrfToken) {
    headers["X-CSRFToken"] = csrfToken;
  }

  const res = await fetch(url, {
    headers,
    credentials: "include", // Include cookies for CSRF
    ...options,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error("API Error:", errorData); // Log full error for debugging
    throw new Error(errorData.detail || JSON.stringify(errorData) || res.statusText);
  }

  return res.json();
};

// ------------------- SIGNUP -------------------
export const signup = async (email: string, username: string, password: string) => {
  const data = await request(`${API_URL}/signup/`, {
    method: "POST",
    body: JSON.stringify({ email, username, password }),
  });

  // Optional: automatically log in after signup
  await login(email, password);
  return data;
};

// ------------------- LOGIN -------------------
export const login = async (emailOrUsername: string, password: string) => {
  const data = await request(`${API_URL}/login/`, {
    method: "POST",
    body: JSON.stringify({ email_or_username: emailOrUsername, password }),
  });

  // Store user info and JWT token
  localStorage.setItem(LOGGED_IN_KEY, JSON.stringify(data.user));
  localStorage.setItem(ACCESS_TOKEN_KEY, data.access);
  return data.user as User;
};

// ------------------- LOGOUT -------------------
export const logout = () => {
  localStorage.removeItem(LOGGED_IN_KEY);
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(LAST_SYNC_KEY);
};

// ------------------- GET CURRENT USER -------------------
export const getCurrentUser = (): Omit<User, "password"> | null => {
  const data = localStorage.getItem(LOGGED_IN_KEY);
  return data ? JSON.parse(data) : null;
};

// ------------------- AUTH HEADERS HELPER -------------------
export const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
};

// ------------------- AUTH FETCH HELPER -------------------
/**
 * Handles authenticated fetch requests with JSON or FormData
 */
export const authFetch = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!token) throw new Error("Not authenticated");

  // Use Headers class for type-safe handling
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);

  // Only set Content-Type if NOT sending FormData
  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.error || res.statusText);
  }

  return res.json();
};

// ------------------- SYNC HELPERS -------------------
export const getLastSync = (): string | null => {
  return localStorage.getItem(LAST_SYNC_KEY);
};

export const setLastSync = (timestamp: string) => {
  localStorage.setItem(LAST_SYNC_KEY, timestamp);
};
