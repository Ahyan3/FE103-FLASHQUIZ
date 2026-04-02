/* eslint-disable @typescript-eslint/no-unused-vars */
// src/pages/home.tsx
// ============================================================
// Dashboard Page Component
// ------------------------------------------------------------
// This is the main landing page after login. It serves as the
// central hub for all of the user's flashcard activity.
//
// Responsibilities:
//   - Display the user's own flashcard sets with filtering
//   - Display sets received/shared from peers
//   - Create, edit, and delete flashcard sets
//   - Manage categories for organizing sets
//   - Trigger manual sync with the backend
//   - Launch modals for sharing, receiving, and file upload
//   - Load quiz session data per set for progress display
//
// Data Flow:
//   1. On mount, check localStorage for a logged-in user
//   2. If no user → redirect to /login
//   3. Perform initial or incremental sync with the backend
//   4. Load sets and categories from IndexedDB (offline-first)
//   5. Fetch quiz session data for each set from the API
//   6. Fetch internet-shared sets from the sharing API
//   7. Render everything with real-time state updates
// ============================================================

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentUser, logout } from "../services/auth";
import { syncWithServer, performInitialSync } from "../services/sync";
import {
  getAllCategories,
  saveCategory,
  getAllSets,
  saveSet,
  deleteSet,
} from "../utils/db";
import { getLastSync } from "../services/auth";
import ShareModal from "./ShareModal";
import ReceiveBluetoothModal from "./Receivemodal";
import CustomModal from "./CustomModal";
import FileUploadModal from "./Fileuploadmodal";
import { useModal } from "../hooks/useModal";
import { getSharedSets, type SharedSet } from "../services/sharedSet";
import { getLatestQuizSession, type QuizSessionData } from "../services/progress";
import { SetProgressStats } from "./SetProgressStats";

// ============================================================
// Type Definitions
// ============================================================

/** A single flashcard with question, answer, and metadata */
interface Flashcard {
  id: string;
  question: string;
  answer: string;
  position?: number;
  created_at?: string;
  updated_at?: string;
  is_deleted?: boolean;
}

/**
 * A collection of flashcards with metadata, progress stats,
 * and source tracking (created locally vs received externally).
 */
interface FlashcardSet {
  id: string;
  title: string;
  category?: string;
  cards: Flashcard[];
  createdAt: string;
  created_at?: string;
  updated_at?: string;
  is_deleted?: boolean;

  /**
   * Tracks how this set entered the app:
   *   - 'created'            → user made it themselves
   *   - 'imported'           → uploaded from a file
   *   - 'qr_scanned'         → scanned a QR code
   *   - 'internet_shared'    → received via share link
   *   - 'bluetooth_received' → received via Bluetooth
   */
  source?: 'created' | 'imported' | 'qr_scanned' | 'internet_shared' | 'bluetooth_received';

  /** Username of the person who originally created/shared this set */
  original_creator?: string;

  /** True if this set was auto-generated from an uploaded file */
  generated_from_file?: boolean;

  /** Original filename if generated_from_file is true */
  source_filename?: string;

  // --- Backend-computed progress fields ---
  // These are calculated by the backend and stored locally for display.
  total_cards?: number;
  mastered_cards?: number;
  learning_cards?: number;
  new_cards?: number;
  last_studied_at?: string;
  study_streak_days?: number;
  total_study_time_seconds?: number;
  overall_accuracy?: number;
  progress_percentage?: number;
}

/** Logged-in user profile stored in localStorage */
interface User {
  id: number;
  email: string;
  username: string;
}

/** A category used to organize flashcard sets */
interface Category {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Normalized display format for the "Shared by Peers" section.
 * Combines internet-shared sets (from the API) and locally received
 * sets (from IndexedDB) into a single unified shape for the UI.
 */
interface DisplaySharedSet {
  id: string;
  title: string;
  category?: string;
  cards_count: number;
  created_by: string;

  /** Where this shared set came from */
  source: 'internet' | 'imported' | 'qr_scanned' | 'bluetooth';

  /** Share code — only present for internet-shared sets */
  share_code?: string;

  allow_download?: boolean;
  allow_copy?: boolean;
  created_at: string;
}

/**
 * Extends FlashcardSet with an optional latest quiz session.
 * Loaded from the backend for each set so the dashboard can
 * show quiz accuracy alongside the study progress stats.
 */
interface SetWithQuizSession extends FlashcardSet {
  latestQuizSession?: QuizSessionData['quiz_session'];
}

// ============================================================
// Utilities
// ============================================================

/**
 * Generates a UUID v4 string for new sets and categories.
 * Uses the native crypto.randomUUID() if available (modern browsers),
 * with a manual Math.random() fallback for older environments.
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // RFC 4122 v4 UUID fallback using Math.random()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ============================================================
// Dashboard Component
// ============================================================
export default function Dashboard() {
  // ---- Navigation ----
  const navigate = useNavigate();

  // ---- Custom Modal Hook ----
  // Provides showAlert(), showConfirm(), and closeModal() helpers
  // along with modalState for rendering the CustomModal component
  const { modalState, showAlert, showConfirm, closeModal } = useModal();
  
  // ---- Auth & User State ----
  const [user, setUser] = useState<User | null>(null);

  // ---- Data State ----
  /** Category names extracted from IndexedDB for filter buttons */
  const [categories, setCategories] = useState<string[]>([]);

  /** All user-created sets plus received sets (with quiz data) */
  const [sets, setSets] = useState<SetWithQuizSession[]>([]);

  /**
   * Combined list of internet-shared and locally-received sets
   * for the "Shared by Peers" section at the bottom of the page
   */
  const [sharedSets, setSharedSets] = useState<DisplaySharedSet[]>([]);

  /** True while the shared sets section is refreshing */
  const [loadingSharedSets, setLoadingSharedSets] = useState(false);

  // ---- Filter State ----
  /** Currently selected category filter ("All", "Uncategorized", or a category name) */
  const [filter, setFilter] = useState("All");

  // ---- Loading / Syncing State ----
  /** True while initial data is loading from DB on mount */
  const [loading, setLoading] = useState(true);

  /** True while a manual sync is in progress */
  const [syncing, setSyncing] = useState(false);

  /** Controls the mobile hamburger menu visibility */
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // ---- Modal Visibility State ----
  /** Controls the "Create New Set" modal */
  const [showCreateModal, setShowCreateModal] = useState(false);

  /** Controls the "Edit Set" modal */
  const [showEditModal, setShowEditModal] = useState(false);

  /** The set being edited (populated when Edit is clicked) */
  const [editingSet, setEditingSet] = useState<FlashcardSet | null>(null);

  // ---- Form Input State (shared by Create & Edit modals) ----
  const [newSetTitle, setNewSetTitle] = useState("");
  const [newSetCategory, setNewSetCategory] = useState<string>("");

  /** Controls inline category input visibility in the filter bar */
  const [showCategoryInput, setShowCategoryInput] = useState(false);

  /** Text input for the new category name */
  const [newCategoryName, setNewCategoryName] = useState("");

  // ---- Sharing Modal State ----
  /** Controls the ShareModal visibility */
  const [showShareModal, setShowShareModal] = useState(false);

  /** ID of the set being shared (passed to ShareModal) */
  const [sharingSetId, setSharingSetId] = useState<string | null>(null);

  /** Title of the set being shared (shown in ShareModal header) */
  const [sharingSetTitle, setSharingSetTitle] = useState<string>("");

  /** Controls the Bluetooth receive modal */
  const [showReceiveBluetooth, setShowReceiveBluetooth] = useState(false);

  /** Controls the file upload / AI generation modal */
  const [showFileUpload, setShowFileUpload] = useState(false);

  // ============================================================
  // Effect: Mount — Check Auth & Load Data
  // ------------------------------------------------------------
  // On first render, verify the user is logged in. If not,
  // redirect to login. If yes, store the user in state and
  // kick off the initial data load + sync.
  // ============================================================
  useEffect(() => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      navigate("/login", { replace: true }); // Can't go back with browser back button
      return;
    }
    setUser(currentUser);
    loadData();
  }, [navigate]);

  // ============================================================
  // loadQuizSessionsForSets
  // ------------------------------------------------------------
  // For each flashcard set, fetches the latest quiz session from
  // the backend API and attaches it to the set object.
  //
  // Uses Promise.all() to fetch all sessions in parallel rather
  // than sequentially, which is much faster with many sets.
  //
  // Individual failures are caught and logged per-set so one
  // failing API call doesn't break the whole dashboard load.
  // ============================================================
  const loadQuizSessionsForSets = async (flashcardSets: FlashcardSet[]): Promise<SetWithQuizSession[]> => {
    const setsWithQuizData = await Promise.all(
      flashcardSets.map(async (set) => {
        try {
          const quizData = await getLatestQuizSession(set.id);
          return {
            ...set,
            // Only attach quiz session if one exists for this set
            latestQuizSession: quizData.has_quiz_session ? quizData.quiz_session : undefined
          };
        } catch (error) {
          console.error(`Error loading quiz session for set ${set.id}:`, error);
          return set; // Return the set without quiz data rather than failing
        }
      })
    );
    return setsWithQuizData;
  };

  // ============================================================
  // loadData
  // ------------------------------------------------------------
  // The main data loading function called on mount and after sync.
  //
  // Strategy:
  //   1. Check if this is the first ever sync (no lastSync timestamp)
  //   2. Either perform initial full sync or incremental delta sync
  //   3. Load sets and categories from IndexedDB (offline-first)
  //   4. Enrich sets with quiz session data from the API
  //   5. Load shared sets (internet + local received)
  //
  // Error handling:
  //   - If sync fails (offline), fall back to IndexedDB-only data
  //   - If IndexedDB also fails, log the error and show empty state
  // ============================================================
  const loadData = async () => {
    try {
      const lastSync = getLastSync();
      
      // First-time user: do a full sync to pull all backend data
      if (!lastSync) {
        await performInitialSync();
      } else {
        // Returning user: only pull records changed since last sync
        await syncWithServer();
      }
      
      // Load local data after sync completes
      const [cats, allSets] = await Promise.all([getAllCategories(), getAllSets()]);
      setCategories(cats.map(c => c.name));
      
      // Enrich sets with quiz sessions (parallel API calls)
      const setsWithQuiz = await loadQuizSessionsForSets(allSets);
      setSets(setsWithQuiz);
      
      // Load both internet and local shared sets
      loadSharedSets(allSets);
    } catch (err) {
      // Sync failed (likely offline) — fall back to local IndexedDB data
      console.error("Load/sync error:", err);
      try {
        const [cats, allSets] = await Promise.all([getAllCategories(), getAllSets()]);
        setCategories(cats.map(c => c.name));
        
        // Still attempt to load quiz sessions even without a sync
        const setsWithQuiz = await loadQuizSessionsForSets(allSets);
        setSets(setsWithQuiz);
        
        // Try loading shared sets from local data
        loadSharedSets(allSets);
      } catch (localErr) {
        console.error("Local DB error:", localErr);
        // At this point the DB itself is unavailable — show empty state
      }
    } finally {
      // Always stop the loading spinner regardless of outcome
      setLoading(false);
    }
  };

  // ============================================================
  // loadSharedSets
  // ------------------------------------------------------------
  // Builds the "Shared by Peers" list by combining two sources:
  //
  //   1. Internet shares — fetched from the backend sharing API.
  //      These are sets other users have shared publicly via link.
  //
  //   2. Local received sets — sets in IndexedDB that were received
  //      via file import, QR scan, or Bluetooth. Identified by
  //      their 'source' field.
  //
  // Both sources are merged and sorted newest-first before display.
  // Errors from the internet API are caught silently so local
  // received sets still show even when offline.
  // ============================================================
  const loadSharedSets = async (localSets?: FlashcardSet[]) => {
    setLoadingSharedSets(true);
    try {
      const combined: DisplaySharedSet[] = [];
      
      // --- Source 1: Internet-shared sets from the API ---
      try {
        const internetShared = await getSharedSets();
        internetShared.forEach(shared => {
          combined.push({
            id: shared.flashcard_set.id,
            title: shared.flashcard_set.title,
            category: shared.flashcard_set.category,
            cards_count: shared.flashcard_set.cards_count,
            created_by: shared.created_by,
            source: 'internet',
            share_code: shared.share_code,
            allow_download: shared.allow_download,
            allow_copy: shared.allow_copy,
            created_at: shared.created_at,
          });
        });
      } catch (err) {
        // Non-fatal: user may be offline; local sets still show
        console.error("Error loading internet shared sets:", err);
      }
      
      // --- Source 2: Locally received sets from IndexedDB ---
      // Fall back to the current state sets if no localSets passed in
      const setsToCheck = localSets || sets;
      setsToCheck.forEach(set => {
        // Only include sets that came from external sources
        if (set.source && ['imported', 'qr_scanned', 'bluetooth_received'].includes(set.source)) {
          combined.push({
            id: set.id,
            title: set.title,
            category: set.category,
            // Count only non-deleted cards for display
            cards_count: set.cards.filter(c => !c.is_deleted).length,
            created_by: set.original_creator || 'Unknown',
            // Normalize source to the DisplaySharedSet source union type
            source: set.source === 'imported' ? 'imported' : 
                    set.source === 'qr_scanned' ? 'qr_scanned' : 'bluetooth',
            created_at: set.created_at || set.createdAt,
          });
        }
      });
      
      // Sort newest first so most recently received sets appear at the top
      combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      setSharedSets(combined);
    } catch (err) {
      console.error("Error loading shared sets:", err);
    } finally {
      setLoadingSharedSets(false);
    }
  };

  // ============================================================
  // handleManualSync
  // ------------------------------------------------------------
  // Triggered by the "Sync" button in the header.
  // Performs an incremental sync, reloads all local data,
  // and refreshes the shared sets list afterwards.
  // Shows success/error feedback via the CustomModal alert.
  // ============================================================
  const handleManualSync = async () => {
    setSyncing(true);
    try {
      await syncWithServer();

      // Reload everything after sync
      const [cats, allSets] = await Promise.all([getAllCategories(), getAllSets()]);
      setCategories(cats.map(c => c.name));
      
      // Reload quiz sessions after sync (backend may have updated them)
      const setsWithQuiz = await loadQuizSessionsForSets(allSets);
      setSets(setsWithQuiz);
      
      // Refresh the shared sets list
      await loadSharedSets(allSets);
      
      showAlert("Sync completed successfully!", "Success", "success");
    } catch (err) {
      console.error("Sync error:", err);
      showAlert("Sync failed. Please try again.", "Sync Error", "error");
    } finally {
      setSyncing(false);
    }
  };

  // ============================================================
  // handleFileUploadSuccess
  // ------------------------------------------------------------
  // Called by FileUploadModal when the AI has finished generating
  // flashcards from an uploaded file. It:
  //   1. Closes the upload modal
  //   2. Reloads all sets from IndexedDB to include the new one
  //   3. Shows a success alert
  //   4. Navigates to the new set's detail page after 1 second
  //      (delay gives the user time to read the success message)
  // ============================================================
  const handleFileUploadSuccess = async (setId: string) => {
    setShowFileUpload(false);
    
    // Reload sets to show the newly generated one
    const allSets = await getAllSets();
    const setsWithQuiz = await loadQuizSessionsForSets(allSets);
    setSets(setsWithQuiz);
    
    showAlert(
      "Flashcards generated successfully! Opening your new set...",
      "Success",
      "success"
    );
    
    // Brief delay so user sees the success message before navigating
    setTimeout(() => {
      navigate(`/set/${setId}`);
    }, 1000);
  };

  // ============================================================
  // Guard: Not Loaded Yet
  // ============================================================

  // Don't render anything until we know the user is logged in
  if (!user) return null;

  // Show a full-screen loading indicator while syncing on first load
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400 text-lg">Loading...</div>
      </div>
    );
  }

  // ============================================================
  // Derived / Computed Values
  // ============================================================

  /** All category names for the filter bar, including "All" and "Uncategorized" */
  const allFilters = ["All", "Uncategorized", ...categories];

  /**
   * Only sets the user created themselves.
   * Received/imported sets are excluded here and shown in
   * the separate "Shared by Peers" section instead.
   */
  const userCreatedSets = sets.filter(set => 
    !set.source || set.source === 'created'
  );

  /**
   * User-created sets filtered by the selected category.
   * "All" shows everything; "Uncategorized" shows sets with
   * no category; any other value matches the category name.
   */
  const filteredSets = userCreatedSets.filter(set => {
    if (filter === "All") return true;
    if (filter === "Uncategorized") return !set.category || set.category === "Uncategorized";
    return set.category === filter;
  });

  // ============================================================
  // Event Handlers
  // ============================================================

  /** Shows the inline input for adding a new category */
  const handleAddCategory = () => {
    setShowCategoryInput(true);
    setNewCategoryName("");
  };

  // ------------------------------------------------------------
  // handleSaveCategory
  // ------------------------------------------------------------
  // Validates the new category name, saves it to IndexedDB,
  // updates local state, then triggers a background sync so
  // the backend also gets the new category.
  // ------------------------------------------------------------
  const handleSaveCategory = async () => {
    const trimmed = newCategoryName.trim();
    
    // Validation: name must not be empty
    if (!trimmed) {
      showAlert("Please enter a category name", "Invalid Input", "error");
      return;
    }

    // Validation: no duplicate categories
    if (categories.includes(trimmed)) {
      showAlert("Category already exists", "Duplicate Category", "error");
      return;
    }

    // Build the full category object with a fresh UUID and timestamps
    const newCategory: Category = {
      id: generateUUID(),
      name: trimmed,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await saveCategory(newCategory);

    // Update the local filter bar immediately (optimistic UI)
    setCategories(prev => [...prev, trimmed]);
    setShowCategoryInput(false);
    setNewCategoryName("");
    
    // Sync in the background — don't block the UI
    syncWithServer().catch(err => console.error("Background sync failed:", err));
  };

  /** Opens the Create Set modal and resets its form fields */
  const handleCreateSet = () => {
    setNewSetTitle("");
    setNewSetCategory("");
    setShowCreateModal(true);
  };

  // ------------------------------------------------------------
  // handleCreateSetSubmit
  // ------------------------------------------------------------
  // Validates the form, creates the set object with a new UUID,
  // saves it to IndexedDB, optimistically adds it to state,
  // closes the modal, and navigates to the new set's detail page.
  //
  // A background sync sends the new set to the backend without
  // blocking the navigation or UI.
  // ------------------------------------------------------------
  const handleCreateSetSubmit = async () => {
    if (!newSetTitle.trim()) {
      showAlert("Please enter a title", "Invalid Input", "error");
      return;
    }

    try {
      // Default to "Uncategorized" if no category was selected
      const categoryToUse = (newSetCategory && newSetCategory.trim()) ? newSetCategory.trim() : "Uncategorized";

      const newSet: FlashcardSet = {
        id: generateUUID(),
        title: newSetTitle.trim(),
        category: categoryToUse,
        cards: [],                                // Empty cards — user adds cards on the set page
        createdAt: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_deleted: false,
        source: 'created'                        // Mark as user-created for filtering
      };

      await saveSet(newSet);

      // Optimistic UI: add to state immediately without waiting for sync
      setSets(prev => [...prev, newSet]);
      setShowCreateModal(false);
      setNewSetTitle("");
      setNewSetCategory("");
      
      // Background sync — non-blocking
      syncWithServer().catch(err => console.error("Background sync failed:", err));
      
      // Navigate directly to the new set so the user can start adding cards
      navigate(`/set/${newSet.id}`);
    } catch (error) {
      console.error("Error creating set:", error);
      showAlert(
        `Failed to create flashcard set: ${error instanceof Error ? error.message : 'Unknown error'}`,
        "Error",
        "error"
      );
    }
  };

  /** Opens the Edit modal pre-filled with the set's current values */
  const handleEditSet = (set: FlashcardSet) => {
    setEditingSet(set);
    setNewSetTitle(set.title);
    setNewSetCategory(set.category || "");
    setShowEditModal(true);
  };

  // ------------------------------------------------------------
  // handleEditSetSubmit
  // ------------------------------------------------------------
  // Saves the edited title and category to IndexedDB and updates
  // the local state optimistically. Background sync sends the
  // update to the backend without blocking the UI.
  // ------------------------------------------------------------
  const handleEditSetSubmit = async () => {
    if (!editingSet) return;
    if (!newSetTitle.trim()) {
      showAlert("Please enter a title", "Invalid Input", "error");
      return;
    }

    try {
      const updated = {
        ...editingSet,
        title: newSetTitle.trim(),
        category: newSetCategory.trim() || "Uncategorized",
        updated_at: new Date().toISOString() // Ensure sync picks this up as changed
      };

      await saveSet(updated);

      // Update the matching set in state (replace by ID)
      setSets(prev => prev.map(s => s.id === editingSet.id ? updated : s));
      setShowEditModal(false);
      setEditingSet(null);
      setNewSetTitle("");
      setNewSetCategory("");
      
      syncWithServer().catch(err => console.error("Background sync failed:", err));
    } catch (error) {
      console.error("Error updating set:", error);
      showAlert("Failed to update flashcard set. Please try again.", "Error", "error");
    }
  };

  // ------------------------------------------------------------
  // handleDeleteSet
  // ------------------------------------------------------------
  // Shows a confirmation dialog before deleting.
  // Uses soft-delete in IndexedDB (is_deleted: true) so the
  // sync engine can propagate the deletion to the backend.
  //
  // Also removes the set from the shared sets list in case it
  // was a locally received set that appears in both sections.
  // ------------------------------------------------------------
  const handleDeleteSet = async (id: string) => {
    showConfirm(
      "Delete this set and all its cards?",
      async () => {
        await deleteSet(id); // Soft-delete in IndexedDB

        // Remove from both sets and sharedSets state immediately
        setSets(prev => prev.filter(s => s.id !== id));
        setSharedSets(prev => prev.filter(s => s.id !== id));
        
        syncWithServer().catch(err => console.error("Background sync failed:", err));
      },
      "Confirm Delete"
    );
  };

  // ------------------------------------------------------------
  // handleShareSet
  // ------------------------------------------------------------
  // Stores the set's id and title for the ShareModal, then
  // opens it. The modal handles the actual share link creation.
  // ------------------------------------------------------------
  const handleShareSet = (set: FlashcardSet) => {
    setSharingSetId(set.id);
    setSharingSetTitle(set.title);
    setShowShareModal(true);
  };

  // ------------------------------------------------------------
  // handleViewSharedSet
  // ------------------------------------------------------------
  // Navigates to the correct page depending on the set's source:
  //   - Internet shares → /share/:share_code (public share view)
  //   - Local received → /set/:id (standard set detail page)
  // ------------------------------------------------------------
  const handleViewSharedSet = (sharedSet: DisplaySharedSet) => {
    if (sharedSet.source === 'internet' && sharedSet.share_code) {
      navigate(`/share/${sharedSet.share_code}`);
    } else {
      navigate(`/set/${sharedSet.id}`);
    }
  };

  /**
   * Returns an emoji icon for each share source type.
   * Used in the shared sets grid cards.
   */
  const getSourceIcon = (source: DisplaySharedSet['source']) => {
    switch (source) {
      case 'internet': return '🌐';
      case 'imported': return '📁';
      case 'qr_scanned': return '📷';
      case 'bluetooth': return '📡';
      default: return '📚';
    }
  };

  /**
   * Returns a human-readable label for each share source type.
   * Displayed below the set title in the shared sets section.
   */
  const getSourceLabel = (source: DisplaySharedSet['source']) => {
    switch (source) {
      case 'internet': return 'Internet Share';
      case 'imported': return 'File Import';
      case 'qr_scanned': return 'QR Scanned';
      case 'bluetooth': return 'Bluetooth';
      default: return 'Shared';
    }
  };

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">

      {/* ---- Header ---- */}
      {/* Sticky so the sync button and user info are always accessible */}
      <header className="bg-white dark:bg-gray-800 shadow-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Logo */}
            <h1 className="text-2xl sm:text-3xl font-bold text-indigo-600 dark:text-indigo-400">
              FlashQuiz
            </h1>

            {/* Desktop: Sync + Username + Logout */}
            <div className="hidden md:flex items-center gap-3">
              <button
                onClick={handleManualSync}
                disabled={syncing}
                className="px-3 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors text-sm"
              >
                {syncing ? "Syncing..." : "Sync"}
              </button>
              <span className="text-gray-700 dark:text-gray-300 text-sm">
                <strong className="text-gray-900 dark:text-white">@{user.username}</strong>
              </span>
              <button
                onClick={() => {
                  logout(); // Clear localStorage session
                  navigate("/login");
                }}
                className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors text-sm"
              >
                Logout
              </button>
            </div>

            {/* Mobile: Hamburger menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {/* Toggle between X (close) and hamburger (open) icon */}
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>

          {/* Mobile Dropdown Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleManualSync}
                  disabled={syncing}
                  className="px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                >
                  {syncing ? "Syncing..." : "Sync Now"}
                </button>
                <span className="text-gray-700 dark:text-gray-300 px-2 text-sm">
                  Welcome, <strong className="text-gray-900 dark:text-white">@{user.username}</strong>
                </span>
                <button
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                  className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors"
                >
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

        {/* ---- Category Filter Bar ---- */}
        {/* Pill buttons for "All", "Uncategorized", each category, and "+ Category" */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Filter by Category
          </label>
          <div className="flex flex-wrap gap-2">
            {allFilters.map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all ${
                  filter === f
                    ? "bg-indigo-600 text-white shadow-md"          // Active filter
                    : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                {f}
              </button>
            ))}
            {/* Add Category button opens inline input below */}
            <button
              onClick={handleAddCategory}
              className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium bg-green-500 hover:bg-green-600 text-white transition-colors"
            >
              + Category
            </button>
          </div>
        </div>

        {/* ---- Action Buttons ---- */}
        {/* Top-right aligned: Generate from File, Receive Shared Set, New Set */}
        <div className="mb-6 flex flex-col sm:flex-row flex-wrap gap-3 justify-end">
          {/* Opens the AI file-to-flashcard generator modal */}
          <button
            onClick={() => setShowFileUpload(true)}
            className="px-4 py-2.5 sm:px-6 sm:py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all text-sm sm:text-base"
          >
            🤖 Generate from File
          </button>
          {/* Opens the Bluetooth receive modal */}
          <button
            onClick={() => setShowReceiveBluetooth(true)}
            className="px-4 py-2.5 sm:px-6 sm:py-3 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all text-sm sm:text-base"
          >
            📡 Receive Shared Set
          </button>
          {/* Opens the Create Set modal */}
          <button
            onClick={handleCreateSet}
            className="px-4 py-2.5 sm:px-6 sm:py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all text-sm sm:text-base"
          >
            + New Set
          </button>
        </div>

        {/* ---- My Sets Section ---- */}
        <section className="mb-8">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
            My Flashcard Sets ({filteredSets.length})
          </h2>

          {/* Empty state message when no sets match the current filter */}
          {filteredSets.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 sm:p-8 text-center">
              <p className="text-gray-500 dark:text-gray-400 italic text-sm sm:text-base">
                {filter === "All"
                  ? "You don't have any flashcard sets yet."
                  : filter === "Uncategorized"
                  ? "No uncategorized sets."
                  : `No sets in "${filter}"`}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {filteredSets.map(set => (
                <div
                  key={set.id}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-xl transition-all p-4 sm:p-6"
                >
                  {/* Clickable area navigates to the set detail page */}
                  <div
                    onClick={() => navigate(`/set/${set.id}`)}
                    className="cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white break-words flex-1">
                        {set.title}
                      </h3>
                      {/* Robot icon badge for AI-generated sets */}
                      {set.generated_from_file && (
                        <span className="ml-2 text-xl flex-shrink-0" title="Generated from file">
                          🤖
                        </span>
                      )}
                    </div>
                    
                    {/* Category, card count, creation date */}
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-3">
                      {set.category || "Uncategorized"} • {set.cards.length} cards •{" "}
                      {new Date(set.createdAt).toLocaleDateString()}
                    </p>
                    
                    {/* Show the source filename for AI-generated sets */}
                    {set.source_filename && (
                      <p className="text-xs text-indigo-600 dark:text-indigo-400 mb-3">
                        📄 From: {set.source_filename}
                      </p>
                    )}
                    
                    {/* Last studied date badge */}
                    {set.last_studied_at && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                        Last studied: {new Date(set.last_studied_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  
                  {/* Progress stats bar — only shown if backend has progress data */}
                  {(set.total_cards !== undefined && set.total_cards > 0) && (
                    <div className="mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                      <SetProgressStats
                        totalCards={set.total_cards || 0}
                        masteredCards={set.mastered_cards || 0}
                        learningCards={set.learning_cards || 0}
                        newCards={set.new_cards || 0}
                        overallAccuracy={set.overall_accuracy || 0}
                        progressPercentage={set.progress_percentage || 0}
                        lastStudiedAt={set.last_studied_at}
                        studyTimeSeconds={set.total_study_time_seconds}
                        latestQuizSession={set.latestQuizSession}
                        compact={true}
                      />
                    </div>
                  )}
                  
                  {/* Action links — e.stopPropagation() prevents card click from firing */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={e => { e.stopPropagation(); handleShareSet(set); }}
                      className="text-blue-600 dark:text-blue-400 hover:underline text-xs sm:text-sm font-medium"
                    >
                      Share
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleEditSet(set); }}
                      className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs sm:text-sm font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteSet(set.id); }}
                      className="text-red-600 dark:text-red-400 hover:underline text-xs sm:text-sm font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---- Shared by Peers Section ---- */}
        {/* Shows sets received from others via any sharing method */}
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 dark:text-gray-200">
              Shared by Peers ({sharedSets.length})
            </h2>
            {/* Manual refresh button for the shared sets list */}
            <button
              onClick={() => loadSharedSets()}
              disabled={loadingSharedSets}
              className="px-3 py-1.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg text-sm font-medium hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors disabled:opacity-50"
            >
              {loadingSharedSets ? "Refreshing..." : "🔄 Refresh"}
            </button>
          </div>

          {/* Loading state while shared sets are first being fetched */}
          {loadingSharedSets && sharedSets.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-gray-500 dark:text-gray-400">Loading shared sets...</div>
            </div>
          ) : sharedSets.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 italic text-center py-4 text-sm sm:text-base">
              No shared sets available from peers yet. Import files, scan QR codes, or receive from others!
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sharedSets.map(shared => (
                <div
                  key={`${shared.source}-${shared.id}`} // Composite key avoids ID collisions between sources
                  className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-lg shadow-md hover:shadow-xl transition-all p-4 sm:p-5 border border-indigo-100 dark:border-indigo-800"
                >
                  {/* Clickable area — navigates based on source type */}
                  <div
                    onClick={() => handleViewSharedSet(shared)}
                    className="cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-1 break-words flex-1">
                        {shared.title}
                      </h3>
                      {/* Source icon in top-right corner of card */}
                      <span className="ml-2 text-xl flex-shrink-0">
                        {getSourceIcon(shared.source)}
                      </span>
                    </div>
                    
                    <div className="space-y-2 mb-3">
                      <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                        {shared.category || "Uncategorized"} • {shared.cards_count} cards
                      </p>
                      <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                        👤 By @{shared.created_by}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-500">
                        📍 {getSourceLabel(shared.source)}
                      </p>
                    </div>

                    {/* Permission badges for internet-shared sets */}
                    <div className="flex flex-wrap gap-2 text-xs mb-3">
                      {shared.source === 'internet' && (
                        <>
                          {shared.allow_copy && (
                            <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-1 rounded">
                              📚 Copyable
                            </span>
                          )}
                          {shared.allow_download && (
                            <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded">
                              ⬇️ Downloadable
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* View + Delete buttons at the bottom of each shared set card */}
                  <div className="pt-3 border-t border-indigo-200 dark:border-indigo-700 flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleViewSharedSet(shared); }}
                      className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      View Set →
                    </button>
                    {/* Delete only shown for local received sets, not internet-shared ones */}
                    {shared.source !== 'internet' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteSet(shared.id); }}
                        className="px-3 py-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ============================================================ */}
      {/* Modals — rendered outside main so they overlay everything     */}
      {/* ============================================================ */}

      {/* ---- Create Set Modal ---- */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto animate-slide-up">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Create New Flashcard Set
            </h3>
            
            <div className="space-y-4">
              {/* Title field — required */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Title *
                </label>
                <input
                  type="text"
                  value={newSetTitle}
                  onChange={(e) => setNewSetTitle(e.target.value)}
                  placeholder="Enter set title"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  autoFocus
                />
              </div>

              {/* Category dropdown — optional, defaults to Uncategorized */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Category (optional)
                </label>
                <select
                  value={newSetCategory}
                  onChange={(e) => setNewSetCategory(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="">Uncategorized</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowCreateModal(false); setNewSetTitle(""); setNewSetCategory(""); }}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSetSubmit}
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Edit Set Modal ---- */}
      {showEditModal && editingSet && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto animate-slide-up">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Edit Flashcard Set
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Title *
                </label>
                <input
                  type="text"
                  value={newSetTitle}
                  onChange={(e) => setNewSetTitle(e.target.value)}
                  placeholder="Enter set title"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Category
                </label>
                <select
                  value={newSetCategory}
                  onChange={(e) => setNewSetCategory(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="">Uncategorized</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowEditModal(false); setEditingSet(null); setNewSetTitle(""); setNewSetCategory(""); }}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSetSubmit}
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Add Category Modal ---- */}
      {showCategoryInput && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 animate-slide-up">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Add New Category
            </h3>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Category Name *
              </label>
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="Enter category name"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 focus:border-transparent"
                autoFocus
                onKeyPress={(e) => {
                  // Allow pressing Enter to submit without clicking the button
                  if (e.key === 'Enter') {
                    handleSaveCategory();
                  }
                }}
              />
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowCategoryInput(false); setNewCategoryName(""); }}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCategory}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Share Modal ---- */}
      {/* Rendered conditionally — only when a set has been selected for sharing */}
      {showShareModal && sharingSetId && (
        <ShareModal
          flashcardSetId={sharingSetId}
          flashcardSetTitle={sharingSetTitle}
          onClose={() => {
            setShowShareModal(false);
            setSharingSetId(null);
            setSharingSetTitle("");
          }}
        />
      )}

      {/* ---- Receive Bluetooth Modal ---- */}
      {showReceiveBluetooth && (
        <ReceiveBluetoothModal
          onClose={() => setShowReceiveBluetooth(false)}
        />
      )}

      {/* ---- File Upload / AI Generation Modal ---- */}
      {showFileUpload && (
        <FileUploadModal
          categories={categories}
          onClose={() => setShowFileUpload(false)}
          onSuccess={handleFileUploadSuccess}
        />
      )}

      {/* ---- Custom Alert/Confirm Modal ---- */}
      {/* Handles all showAlert() and showConfirm() calls from handlers above */}
      <CustomModal
        isOpen={modalState.isOpen}
        onClose={closeModal}
        onConfirm={modalState.onConfirm}
        title={modalState.title}
        message={modalState.message}
        type={modalState.type}
      />
    </div>
  );
}