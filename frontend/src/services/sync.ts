/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/sync.ts
import { authFetch, getLastSync, setLastSync } from "./auth";
import {
  getAllCategories, saveCategory, getAllSetsIncludingDeleted, saveSet, clearAllData
} from "../utils/db";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

// ==================== Sync Functions ====================

export async function syncWithServer(): Promise<void> {
  const lastSync = getLastSync();
  
  // Get all local data (including deleted items for sync)
  const [localCategories, localSets] = await Promise.all([
    getAllCategories(),
    getAllSetsIncludingDeleted() // Get ALL sets including deleted ones
  ]);
  
  // Prepare sync payload
  const payload = {
    last_sync: lastSync,
    categories: localCategories.map(cat => ({
      id: cat.id,
      name: cat.name,
      updated_at: cat.updated_at
    })),
   flashcard_sets: localSets.map(set => ({
  id: set.id,
  title: set.title,
  category: set.category,
  created_at: set.created_at || set.createdAt,
  updated_at: set.updated_at,
  is_deleted: set.is_deleted || false,
  

  total_cards: set.total_cards || 0,
  mastered_cards: set.mastered_cards || 0,
  learning_cards: set.learning_cards || 0,
  new_cards: set.new_cards || 0,
  last_studied_at: set.last_studied_at,
  study_streak_days: set.study_streak_days || 0,
  total_study_time_seconds: set.total_study_time_seconds || 0,
  overall_accuracy: set.overall_accuracy || 0,
  progress_percentage: set.progress_percentage || 0,
  
  cards: set.cards.map(card => ({
    id: card.id,
    question: card.question,
    answer: card.answer,
    position: card.position || 0,
    updated_at: card.updated_at,
    is_deleted: card.is_deleted || false
  }))
}))
  };
  
  console.log('Sending to server:', payload.flashcard_sets.map(s => ({
    id: s.id,
    title: s.title,
    is_deleted: s.is_deleted,
    updated_at: s.updated_at
  })));
  
  // Send to server
  const response = await authFetch(`${API_URL}/sync/`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  
  console.log('Received from server:', response.flashcard_sets?.map((s: any) => ({
    id: s.id,
    title: s.title,
    is_deleted: s.is_deleted,
    updated_at: s.updated_at
  })));
  
  // Update local database with server response
  await mergeServerData(response);
  
  // Update last sync timestamp
  setLastSync(response.sync_timestamp);
}

export async function performInitialSync(): Promise<void> {
  try {
    const response = await authFetch(`${API_URL}/sync/initial/`, {
      method: "GET"
    });
    
    // Clear local data first
    await clearAllData();
    
    // Save all server data to IndexedDB
    await mergeServerData(response);
    
    setLastSync(response.sync_timestamp);
  } catch (error) {
    console.error("Initial sync failed:", error);
    throw error;
  }
}

async function mergeServerData(response: any): Promise<void> {
  const serverCategories = response.categories || [];
  const serverSets = response.flashcard_sets || [];
  
  // Merge categories
  for (const serverCat of serverCategories) {
    await saveCategory({
      id: serverCat.id,
      name: serverCat.name,
      created_at: serverCat.created_at,
      updated_at: serverCat.updated_at
    });
  }
  
  // Merge ALL sets (including deleted ones from server)
  // The key is to save them WITH the is_deleted flag from server
  for (const serverSet of serverSets) {
  await saveSet({
    id: serverSet.id,
    title: serverSet.title,
    category: serverSet.category,
    createdAt: serverSet.created_at,
    created_at: serverSet.created_at,
    updated_at: serverSet.updated_at,
    is_deleted: serverSet.is_deleted || false,
    
    // NEW: Save progress fields from server
    total_cards: serverSet.total_cards || 0,
    mastered_cards: serverSet.mastered_cards || 0,
    learning_cards: serverSet.learning_cards || 0,
    new_cards: serverSet.new_cards || 0,
    last_studied_at: serverSet.last_studied_at,
    study_streak_days: serverSet.study_streak_days || 0,
    total_study_time_seconds: serverSet.total_study_time_seconds || 0,
    overall_accuracy: serverSet.overall_accuracy || 0,
    progress_percentage: serverSet.progress_percentage || 0,
    
    cards: serverSet.cards.map((card: any) => ({
      id: card.id,
      question: card.question,
      answer: card.answer,
      position: card.position,
      created_at: card.created_at,
      updated_at: card.updated_at,
      is_deleted: card.is_deleted || false
    }))
  });
}
}

// ==================== Background Sync ====================

export function startBackgroundSync(intervalMinutes: number = 5): number {
  return window.setInterval(async () => {
    try {
      await syncWithServer();
      console.log("Background sync completed");
    } catch (error) {
      console.error("Background sync failed:", error);
    }
  }, intervalMinutes * 60 * 1000);
}

export function stopBackgroundSync(intervalId: number): void {
  clearInterval(intervalId);
}