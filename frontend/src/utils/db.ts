/* eslint-disable @typescript-eslint/no-unused-vars */
// src/utils/db.ts
// ============================================================
// IndexedDB Utility Module — FlashQuizDB
// ------------------------------------------------------------
// This module manages all local database operations using the
// browser's built-in IndexedDB API. It acts as the offline
// data layer for the FlashQuiz app, storing flashcard sets
// and categories locally so the app works without an internet
// connection.
//
// Architecture:
//   - Uses a singleton pattern: only one IDBDatabase instance
//     is kept open at a time to prevent connection conflicts.
//   - A shared promise (dbPromise) prevents duplicate open
//     requests from racing if multiple callers ask for the DB
//     at the same time before it's ready.
//   - All public functions return Promises so they can be used
//     with async/await throughout the app.
//
// Stores (tables):
//   - flashcardSets  → Stores FlashcardSet objects with cards
//   - categories     → Stores Category objects
//
// Versioning:
//   - Current version: DB_VERSION = 5
//   - onupgradeneeded handles incremental migrations between
//     versions so existing user data is preserved on update.
// ============================================================

import type { FlashcardSet, Flashcard, Category } from "../types/flashcard";

// ============================================================
// Constants
// ============================================================

/** The name of the IndexedDB database used by the app */
const DB_NAME = "FlashQuizDB_v5";

/**
 * Current schema version. Increment this whenever you add,
 * remove, or change stores or indexes — IndexedDB will
 * trigger onupgradeneeded automatically on the next open.
 */
const DB_VERSION = 5;

/** Object store name for flashcard sets */
const STORE_SETS = "flashcardSets";

/** Object store name for categories */
const STORE_CATEGORIES = "categories";

// ============================================================
// Singleton State
// ------------------------------------------------------------
// We keep a single shared database connection across the app.
// - dbInstance: the open IDBDatabase connection, or null
// - dbPromise:  an in-flight open request, or null
//
// The pattern works like this:
//   1. If dbInstance exists and is valid → return it directly
//   2. If dbPromise exists → someone else is already opening,
//      return the same promise so we don't open twice
//   3. Otherwise → start a new open request, store the promise
// ============================================================

/** Cached open database connection */
let dbInstance: IDBDatabase | null = null;

/** In-flight promise for an ongoing open request */
let dbPromise: Promise<IDBDatabase> | null = null;

// ============================================================
// openDB — Open or Return the Database
// ------------------------------------------------------------
// The main entry point for getting a database connection.
// Handles all three cases: existing connection, in-flight
// open, and first-time open with schema migration.
// ============================================================
export function openDB(): Promise<IDBDatabase> {
  // --- Corruption check ---
  // If dbInstance exists but has no object stores, something
  // went wrong (e.g., database was deleted externally).
  // Reset so we open a fresh connection.
  if (dbInstance && !dbInstance.objectStoreNames.length) {
    dbInstance = null;
  }
  
  // --- Return existing connection ---
  // If we already have an open, healthy connection, reuse it.
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  // --- Return in-flight promise ---
  // If openDB() was called while a previous open request is
  // still pending, return the same promise to avoid duplicates.
  if (dbPromise) {
    return dbPromise;
  }

  // --- Open a new connection ---
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Failed to open (e.g., storage quota exceeded, private mode)
    request.onerror = () => {
      dbPromise = null; // Allow retry on next call
      reject(request.error);
    };

    // Successfully opened — cache the instance and clean up the promise
    request.onsuccess = () => {
      dbInstance = request.result;
      dbPromise = null;

      // --- Handle version change from another tab ---
      // If another tab opens a newer version of the app, the old
      // connection must close to allow the upgrade to proceed.
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
      };

      // --- Handle unexpected close ---
      // If the connection closes for any reason (browser cleanup,
      // etc.), clear the cached instance so the next call reopens.
      dbInstance.onclose = () => {
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    // ============================================================
    // onupgradeneeded — Schema Migration
    // ------------------------------------------------------------
    // Runs when opening the DB for the first time OR when
    // DB_VERSION is higher than what's stored on disk.
    //
    // Rules:
    //   - Always check objectStoreNames.contains() before creating
    //     a store — IndexedDB throws if you create a duplicate.
    //   - Use oldVersion to apply incremental migrations so users
    //     upgrading from v3 → v5 don't lose their data.
    // ============================================================
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion; // Version before this upgrade

      // --- Categories Store ---
      // Create the categories store if it doesn't exist yet.
      // keyPath: "id" means IndexedDB uses the id field as the primary key.
      // The updated_at index allows efficient querying by modification date.
      if (!db.objectStoreNames.contains(STORE_CATEGORIES)) {
        const catStore = db.createObjectStore(STORE_CATEGORIES, { keyPath: "id" });
        catStore.createIndex("updated_at", "updated_at", { unique: false });
      }

      // --- Flashcard Sets Store ---
      if (!db.objectStoreNames.contains(STORE_SETS)) {
        // First-time creation: set up all indexes from scratch
        const store = db.createObjectStore(STORE_SETS, { keyPath: "id" });

        // Index by category for filtering sets in the dashboard
        store.createIndex("category", "category", { unique: false });

        // Index by updated_at for sync (find recently changed sets)
        store.createIndex("updated_at", "updated_at", { unique: false });

        // Index by source to distinguish created vs received sets
        store.createIndex("source", "source", { unique: false });
      } else if (oldVersion < 5) {
        // --- Migration: v4 → v5 ---
        // The "source" index was added in v5. If the store already exists
        // (user was on v4), add the missing index without recreating the store.
        const tx = (event.target as IDBOpenDBRequest).transaction;
        const store = tx?.objectStore(STORE_SETS);
        if (store && !store.indexNames.contains("source")) {
          store.createIndex("source", "source", { unique: false });
        }
      }
    };

    // --- Blocked upgrade ---
    // If another tab has the same DB open and hasn't responded to
    // onversionchange yet, the upgrade is blocked. Warn the user.
    request.onblocked = () => {
      console.warn('Database upgrade blocked. Please close other tabs.');
    };
  });

  return dbPromise;
}

// ============================================================
// getDB — Internal Helper with Retry Logic
// ------------------------------------------------------------
// Wraps openDB() with a single retry in case of transient
// errors (e.g., the connection was closed unexpectedly).
// All exported functions use getDB() instead of openDB()
// directly for this extra resilience.
// ============================================================
async function getDB(): Promise<IDBDatabase> {
  try {
    return await openDB();
  } catch (error) {
    // Reset singleton state and try once more
    dbInstance = null;
    dbPromise = null;
    return await openDB();
  }
}

// ============================================================
// CATEGORIES — CRUD Operations
// ============================================================

// ------------------------------------------------------------
// getAllCategories
// ------------------------------------------------------------
// Retrieves every category stored locally.
// Returns an empty array rather than throwing if the store
// is empty — callers don't need to handle the empty case.
// ------------------------------------------------------------
export async function getAllCategories(): Promise<Category[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      // "readonly" transaction — we're only reading, not writing
      const tx = db.transaction(STORE_CATEGORIES, "readonly");
      const store = tx.objectStore(STORE_CATEGORIES);
      const req = store.getAll(); // Fetch all records in the store

      req.onsuccess = () => resolve(req.result || []); // Fallback to []
      req.onerror = () => reject(req.error);
      
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}

// ------------------------------------------------------------
// saveCategory
// ------------------------------------------------------------
// Inserts or updates a single category using put().
// put() behaves like an upsert: if a record with the same
// id exists it will be replaced; otherwise it's inserted.
//
// We also ensure updated_at is always set so sync logic
// can detect which records changed since the last sync.
// ------------------------------------------------------------
export async function saveCategory(category: Category): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      // "readwrite" transaction required for put/add/delete operations
      const tx = db.transaction(STORE_CATEGORIES, "readwrite");
      tx.objectStore(STORE_CATEGORIES).put({
        ...category,
        // Preserve existing updated_at or default to now
        updated_at: category.updated_at || new Date().toISOString()
      });

      // Resolve only after the transaction fully completes (not just the put)
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}

// ============================================================
// FLASHCARD SETS — CRUD Operations
// ============================================================

// ------------------------------------------------------------
// getAllSets
// ------------------------------------------------------------
// Returns all non-deleted flashcard sets from local storage.
// Soft-deleted sets (is_deleted: true) are filtered out here
// so callers don't need to filter themselves.
// ------------------------------------------------------------
export async function getAllSets(): Promise<FlashcardSet[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SETS, "readonly");
      const req = tx.objectStore(STORE_SETS).getAll();
      
      req.onsuccess = () => {
        // Filter out soft-deleted sets before returning
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

// ------------------------------------------------------------
// getAllSetsIncludingDeleted
// ------------------------------------------------------------
// Returns ALL sets, including soft-deleted ones.
// Used exclusively by the sync engine, which needs to send
// deleted records to the backend so the server knows to
// delete them there too (tombstone sync pattern).
// ------------------------------------------------------------
export async function getAllSetsIncludingDeleted(): Promise<FlashcardSet[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SETS, "readonly");
      const req = tx.objectStore(STORE_SETS).getAll();
      
      req.onsuccess = () => {
        // Return ALL sets — no is_deleted filter here
        resolve(req.result || []);
      };
      req.onerror = () => reject(req.error);
      
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}

// ------------------------------------------------------------
// getSetById
// ------------------------------------------------------------
// Fetches a single flashcard set by its UUID.
// Returns null if not found OR if the set is soft-deleted,
// treating deleted sets as if they don't exist to the UI.
// ------------------------------------------------------------
export async function getSetById(id: string): Promise<FlashcardSet | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SETS, "readonly");
      const req = tx.objectStore(STORE_SETS).get(id); // Lookup by primary key

      req.onsuccess = () => {
        const set = req.result;
        // Treat soft-deleted sets the same as missing sets
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

// ------------------------------------------------------------
// saveSet
// ------------------------------------------------------------
// Inserts or updates a full flashcard set including all its
// cards. Uses put() for upsert behaviour.
//
// Extra processing applied before saving:
//   - updated_at is refreshed to the current time
//   - source defaults to 'created' if not already set
//   - Each card gets a position index and updated_at timestamp
//     so cards can be re-ordered and synced correctly
// ------------------------------------------------------------
export async function saveSet(set: FlashcardSet): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SETS, "readwrite");

      // Build the final object to persist
      const setToSave = {
        ...set,
        updated_at: new Date().toISOString(),

        // Preserve source (created / imported / bluetooth_received / etc.)
        // Defaults to 'created' for sets made in this app
        source: set.source || 'created',

        // Preserve optional original_creator field for received sets
        original_creator: set.original_creator,

        // Normalize each card's position and updated_at
        cards: set.cards.map((card, index) => ({
          ...card,
          position: card.position ?? index, // Use existing position or array index
          updated_at: card.updated_at || new Date().toISOString()
        }))
      };
      
      const request = tx.objectStore(STORE_SETS).put(setToSave);
      
      request.onerror = () => reject(request.error);
      
      // Resolve after the full transaction completes, not just the put()
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}

// ------------------------------------------------------------
// deleteSet
// ------------------------------------------------------------
// Soft-deletes a flashcard set by setting is_deleted = true
// and updating the timestamp — the record is NOT removed from
// IndexedDB. This allows the sync engine to detect the deletion
// and propagate it to the backend on the next sync cycle.
//
// Hard deletion would cause sync to lose track of the change.
// ------------------------------------------------------------
export async function deleteSet(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_SETS, "readwrite");
      const store = tx.objectStore(STORE_SETS);
      
      // First fetch the existing record
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const set = getReq.result;
        if (set) {
          // Mark as deleted and update timestamp (tombstone record)
          set.is_deleted = true;
          set.updated_at = new Date().toISOString();
          store.put(set); // Write the tombstone back to IndexedDB
        }
        // If set doesn't exist, silently succeed (idempotent delete)
      };
      getReq.onerror = () => reject(getReq.error);
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}

// ------------------------------------------------------------
// clearAllData
// ------------------------------------------------------------
// Wipes all sets and categories from IndexedDB entirely.
// Used when the user logs out or wants a full data reset.
// Unlike deleteSet(), this is a hard wipe — data is gone.
//
// Both stores are cleared in a single atomic transaction so
// either both succeed or both fail together.
// ------------------------------------------------------------
export async function clearAllData(): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    try {
      // Multi-store transaction — both stores in one atomic operation
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

// ============================================================
// Helper Functions — Filtering by Source
// ============================================================

// ------------------------------------------------------------
// getUserCreatedSets
// ------------------------------------------------------------
// Returns only sets that the user created themselves.
// Excludes sets that were received via sharing, QR code,
// Bluetooth, or imported from files.
//
// Used in the dashboard to show "My Sets" separately from
// "Received Sets".
// ------------------------------------------------------------
export async function getUserCreatedSets(): Promise<FlashcardSet[]> {
  const allSets = await getAllSets();
  // A set is "user created" if it has no source or source === 'created'
  return allSets.filter(set => !set.source || set.source === 'created');
}

// ------------------------------------------------------------
// getReceivedSets
// ------------------------------------------------------------
// Returns only sets that came from external sources — another
// user sharing via link, QR code, Bluetooth, etc.
//
// The 'source' field is set when the set is first saved after
// being received so we can always identify its origin.
// ------------------------------------------------------------
export async function getReceivedSets(): Promise<FlashcardSet[]> {
  const allSets = await getAllSets();
  return allSets.filter(set => 
    // Match any of the known external source types
    set.source && ['imported', 'qr_scanned', 'bluetooth_received', 'internet_shared'].includes(set.source)
  );
}

// ============================================================
// Connection Management
// ============================================================

// ------------------------------------------------------------
// closeDB
// ------------------------------------------------------------
// Explicitly closes the database connection and clears the
// singleton state. Call this when the app is shutting down
// or when you need to allow a version upgrade from another tab.
// ------------------------------------------------------------
export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  dbPromise = null;
}

// ------------------------------------------------------------
// resetDBConnection
// ------------------------------------------------------------
// Force-resets the singleton connection state without waiting
// for the existing connection to close gracefully.
// Use this as a last resort when the connection is stuck or
// the database is returning unexpected errors that a simple
// retry can't fix.
// ------------------------------------------------------------
export function resetDBConnection(): void {
  closeDB();      // Close the existing connection first
  dbInstance = null;  // Redundant but explicit — ensures clean state
  dbPromise = null;
}