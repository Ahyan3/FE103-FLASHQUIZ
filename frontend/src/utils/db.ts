/* eslint-disable @typescript-eslint/no-unused-vars */
// src/utils/db.ts
import type { FlashcardSet, Flashcard, Category } from "../types/flashcard";

const DB_NAME = "FlashQuizDB_v5";
const DB_VERSION = 5;
const STORE_SETS = "flashcardSets";
const STORE_CATEGORIES = "categories";

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  // Return existing instance if available
  if (dbInstance && !dbInstance.objectStoreNames.length) {
    dbInstance = null; // Reset if corrupted
  }
  
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  // Return existing promise if already opening
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbPromise = null;

      // Handle unexpected close
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
      };

      dbInstance.onclose = () => {
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      // Categories store
      if (!db.objectStoreNames.contains(STORE_CATEGORIES)) {
        const catStore = db.createObjectStore(STORE_CATEGORIES, { keyPath: "id" });
        catStore.createIndex("updated_at", "updated_at", { unique: false });
      }

      // Flashcard Sets store
      if (!db.objectStoreNames.contains(STORE_SETS)) {
        const store = db.createObjectStore(STORE_SETS, { keyPath: "id" });
        store.createIndex("category", "category", { unique: false });
        store.createIndex("updated_at", "updated_at", { unique: false });
        store.createIndex("source", "source", { unique: false });
      } else if (oldVersion < 5) {
        // Upgrade existing store to add source index
        const tx = (event.target as IDBOpenDBRequest).transaction;
        const store = tx?.objectStore(STORE_SETS);
        if (store && !store.indexNames.contains("source")) {
          store.createIndex("source", "source", { unique: false });
        }
      }
    };

    request.onblocked = () => {
      console.warn('Database upgrade blocked. Please close other tabs.');
    };
  });

  return dbPromise;
}

// Helper to ensure fresh connection
async function getDB(): Promise<IDBDatabase> {
  try {
    return await openDB();
  } catch (error) {
    // Reset and retry once on error
    dbInstance = null;
    dbPromise = null;
    return await openDB();
  }
}

// ==================== Categories ====================

export async function getAllCategories(): Promise<Category[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_CATEGORIES, "readonly");
      const store = tx.objectStore(STORE_CATEGORIES);
      const req = store.getAll();
      
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
      
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}

export async function saveCategory(category: Category): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_CATEGORIES, "readwrite");
      tx.objectStore(STORE_CATEGORIES).put({
        ...category,
        updated_at: category.updated_at || new Date().toISOString()
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}

// ==================== Flashcard Sets ====================

export async function getAllSets(): Promise<FlashcardSet[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SETS, "readonly");
      const req = tx.objectStore(STORE_SETS).getAll();
      
      req.onsuccess = () => {
        const sets = (req.result || []).filter((s: FlashcardSet) => !s.is_deleted);
        resolve(sets);
      };
      req.onerror = () => reject(req.error);
      
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}

export async function getAllSetsIncludingDeleted(): Promise<FlashcardSet[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SETS, "readonly");
      const req = tx.objectStore(STORE_SETS).getAll();
      
      req.onsuccess = () => {
        // Return ALL sets including deleted ones for sync
        resolve(req.result || []);
      };
      req.onerror = () => reject(req.error);
      
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}

export async function getSetById(id: string): Promise<FlashcardSet | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SETS, "readonly");
      const req = tx.objectStore(STORE_SETS).get(id);
      
      req.onsuccess = () => {
        const set = req.result;
        if (set && !set.is_deleted) {
          resolve(set);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
      
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}

export async function saveSet(set: FlashcardSet): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SETS, "readwrite");
      const setToSave = {
        ...set,
        updated_at: new Date().toISOString(),
        // Preserve source and original_creator if they exist
        source: set.source || 'created',
        original_creator: set.original_creator,
        cards: set.cards.map((card, index) => ({
          ...card,
          position: card.position ?? index,
          updated_at: card.updated_at || new Date().toISOString()
        }))
      };
      
      const request = tx.objectStore(STORE_SETS).put(setToSave);
      
      request.onerror = () => reject(request.error);
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}

export async function deleteSet(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SETS, "readwrite");
      const store = tx.objectStore(STORE_SETS);
      
      // Soft delete: mark as deleted with updated timestamp
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const set = getReq.result;
        if (set) {
          set.is_deleted = true;
          set.updated_at = new Date().toISOString();
          store.put(set);
        }
      };
      getReq.onerror = () => reject(getReq.error);
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction([STORE_SETS, STORE_CATEGORIES], "readwrite");
      tx.objectStore(STORE_SETS).clear();
      tx.objectStore(STORE_CATEGORIES).clear();
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}

// ==================== Helper functions for filtering ====================

/**
 * Get only user-created sets (excludes received/imported sets)
 */
export async function getUserCreatedSets(): Promise<FlashcardSet[]> {
  const allSets = await getAllSets();
  return allSets.filter(set => !set.source || set.source === 'created');
}

/**
 * Get only received sets (imported, QR scanned, bluetooth, etc.)
 */
export async function getReceivedSets(): Promise<FlashcardSet[]> {
  const allSets = await getAllSets();
  return allSets.filter(set => 
    set.source && ['imported', 'qr_scanned', 'bluetooth_received', 'internet_shared'].includes(set.source)
  );
}

/**
 * Close database connection (call this when app is closing)
 */
export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  dbPromise = null;
}

/**
 * Force reset database connection (use if encountering persistent issues)
 */
export function resetDBConnection(): void {
  closeDB();
  dbInstance = null;
  dbPromise = null;
}