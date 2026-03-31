// src/services/sharedSets.ts
import { API_URL } from "./auth";

export interface SharedSet {
  share_code: string;
  flashcard_set: {
    id: string;
    title: string;
    category?: string;
    cards_count: number;
    created_at: string;
  };
  created_by: string;
  allow_download: boolean;
  allow_copy: boolean;
  created_at: string;
  expires_at?: string | null;
}

export interface SharedSetsResponse {
  shared_sets: SharedSet[];
  count?: number;
}

/**
 * Fetch all publicly shared flashcard sets from peers
 */
export async function getSharedSets(): Promise<SharedSet[]> {
  const token = localStorage.getItem("token");
  if (!token) {
    throw new Error("Not authenticated");
  }

  // Use environment variable or fallback
  const apiBase = import.meta.env.VITE_API_URL || API_URL || 'http://192.168.8.36:8000/api';

  try {
    const response = await fetch(`${apiBase}/shared-sets/`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Failed to fetch shared sets: ${response.statusText}`);
    }

    const data: SharedSetsResponse = await response.json();
    return data.shared_sets;
  } catch (error) {
    console.error("Error fetching shared sets:", error);
    throw error;
  }
}

/**
 * Search for shared sets by title or category
 */
export async function searchSharedSets(query: string): Promise<SharedSet[]> {
  const token = localStorage.getItem("token");
  if (!token) {
    throw new Error("Not authenticated");
  }

  // Use environment variable or fallback
  const apiBase = import.meta.env.VITE_API_URL || API_URL || 'http://192.168.8.36:8000/api';

  try {
    const response = await fetch(`${apiBase}/shared-sets/search?q=${encodeURIComponent(query)}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Failed to search shared sets: ${response.statusText}`);
    }

    const data: SharedSetsResponse = await response.json();
    return data.shared_sets;
  } catch (error) {
    console.error("Error searching shared sets:", error);
    throw error;
  }
}