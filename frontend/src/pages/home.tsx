/* eslint-disable @typescript-eslint/no-unused-vars */
// src/pages/home.tsx
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

// ────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────

interface Flashcard {
  id: string;
  question: string;
  answer: string;
  position?: number;
  created_at?: string;
  updated_at?: string;
  is_deleted?: boolean;
}

interface FlashcardSet {
  id: string;
  title: string;
  category?: string;
  cards: Flashcard[];
  createdAt: string;
  created_at?: string;
  updated_at?: string;
  is_deleted?: boolean;
  // Source tracking
  source?: 'created' | 'imported' | 'qr_scanned' | 'internet_shared' | 'bluetooth_received';
  original_creator?: string; // Username of who created/shared it
  generated_from_file?: boolean;
  source_filename?: string;

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

interface User {
  id: number;
  email: string;
  username: string;
}

interface Category {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}

// Combined type for display in shared section
interface DisplaySharedSet {
  id: string;
  title: string;
  category?: string;
  cards_count: number;
  created_by: string;
  source: 'internet' | 'imported' | 'qr_scanned' | 'bluetooth';
  share_code?: string; // Only for internet shares
  allow_download?: boolean;
  allow_copy?: boolean;
  created_at: string;
}

// ✅ NEW: Track quiz sessions for each set
interface SetWithQuizSession extends FlashcardSet {
  latestQuizSession?: QuizSessionData['quiz_session'];
}

// ────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();
  const { modalState, showAlert, showConfirm, closeModal } = useModal();
  
  const [user, setUser] = useState<User | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [sets, setSets] = useState<SetWithQuizSession[]>([]);
  const [sharedSets, setSharedSets] = useState<DisplaySharedSet[]>([]);
  const [loadingSharedSets, setLoadingSharedSets] = useState(false);
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingSet, setEditingSet] = useState<FlashcardSet | null>(null);
  const [newSetTitle, setNewSetTitle] = useState("");
  const [newSetCategory, setNewSetCategory] = useState<string>("");
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // Sharing modal states
  const [showShareModal, setShowShareModal] = useState(false);
  const [sharingSetId, setSharingSetId] = useState<string | null>(null);
  const [sharingSetTitle, setSharingSetTitle] = useState<string>("");
  const [showReceiveBluetooth, setShowReceiveBluetooth] = useState(false);

  // File upload modal state
  const [showFileUpload, setShowFileUpload] = useState(false);

  useEffect(() => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      navigate("/login", { replace: true });
      return;
    }
    setUser(currentUser);
    loadData();
  }, [navigate]);

  // ✅ NEW: Load quiz sessions for sets
  const loadQuizSessionsForSets = async (flashcardSets: FlashcardSet[]): Promise<SetWithQuizSession[]> => {
    const setsWithQuizData = await Promise.all(
      flashcardSets.map(async (set) => {
        try {
          const quizData = await getLatestQuizSession(set.id);
          return {
            ...set,
            latestQuizSession: quizData.has_quiz_session ? quizData.quiz_session : undefined
          };
        } catch (error) {
          console.error(`Error loading quiz session for set ${set.id}:`, error);
          return set;
        }
      })
    );
    return setsWithQuizData;
  };

  const loadData = async () => {
    try {
      const lastSync = getLastSync();
      
      // Perform initial sync if never synced before
      if (!lastSync) {
        await performInitialSync();
      } else {
        // Perform incremental sync
        await syncWithServer();
      }
      
      // Load data from IndexedDB
      const [cats, allSets] = await Promise.all([getAllCategories(), getAllSets()]);
      setCategories(cats.map(c => c.name));
      
      // ✅ Load quiz sessions for all sets
      const setsWithQuiz = await loadQuizSessionsForSets(allSets);
      setSets(setsWithQuiz);
      
      // Load shared sets from both internet and local received sets
      loadSharedSets(allSets);
    } catch (err) {
      console.error("Load/sync error:", err);
      // If sync fails, still try to load from IndexedDB
      try {
        const [cats, allSets] = await Promise.all([getAllCategories(), getAllSets()]);
        setCategories(cats.map(c => c.name));
        
        // ✅ Load quiz sessions even if sync failed
        const setsWithQuiz = await loadQuizSessionsForSets(allSets);
        setSets(setsWithQuiz);
        
        // Try to load shared sets even if sync failed
        loadSharedSets(allSets);
      } catch (localErr) {
        console.error("Local DB error:", localErr);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadSharedSets = async (localSets?: FlashcardSet[]) => {
    setLoadingSharedSets(true);
    try {
      const combined: DisplaySharedSet[] = [];
      
      // 1. Get internet-shared sets from API
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
        console.error("Error loading internet shared sets:", err);
      }
      
      // 2. Get locally received sets (imported, QR scanned, bluetooth)
      const setsToCheck = localSets || sets;
      setsToCheck.forEach(set => {
        if (set.source && ['imported', 'qr_scanned', 'bluetooth_received'].includes(set.source)) {
          combined.push({
            id: set.id,
            title: set.title,
            category: set.category,
            cards_count: set.cards.filter(c => !c.is_deleted).length,
            created_by: set.original_creator || 'Unknown',
            source: set.source === 'imported' ? 'imported' : 
                    set.source === 'qr_scanned' ? 'qr_scanned' : 'bluetooth',
            created_at: set.created_at || set.createdAt,
          });
        }
      });
      
      // Sort by created date (newest first)
      combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      setSharedSets(combined);
    } catch (err) {
      console.error("Error loading shared sets:", err);
    } finally {
      setLoadingSharedSets(false);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      await syncWithServer();
      const [cats, allSets] = await Promise.all([getAllCategories(), getAllSets()]);
      setCategories(cats.map(c => c.name));
      
      // ✅ Reload quiz sessions after sync
      const setsWithQuiz = await loadQuizSessionsForSets(allSets);
      setSets(setsWithQuiz);
      
      // Refresh shared sets after sync
      await loadSharedSets(allSets);
      
      showAlert("Sync completed successfully!", "Success", "success");
    } catch (err) {
      console.error("Sync error:", err);
      showAlert("Sync failed. Please try again.", "Sync Error", "error");
    } finally {
      setSyncing(false);
    }
  };

  const handleFileUploadSuccess = async (setId: string) => {
    setShowFileUpload(false);
    
    // Reload all data to show the new set
    const allSets = await getAllSets();
    const setsWithQuiz = await loadQuizSessionsForSets(allSets);
    setSets(setsWithQuiz);
    
    // Show success message
    showAlert(
      "Flashcards generated successfully! Opening your new set...",
      "Success",
      "success"
    );
    
    // Navigate to the new set after a short delay
    setTimeout(() => {
      navigate(`/set/${setId}`);
    }, 1000);
  };

  if (!user) return null;
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400 text-lg">Loading...</div>
      </div>
    );
  }

  // ── Computed filters ───────────────────────────────
  const allFilters = ["All", "Uncategorized", ...categories];

  // Filter to show only user-created sets (exclude received sets)
  const userCreatedSets = sets.filter(set => 
    !set.source || set.source === 'created'
  );

  const filteredSets = userCreatedSets.filter(set => {
    if (filter === "All") return true;
    if (filter === "Uncategorized") return !set.category || set.category === "Uncategorized";
    return set.category === filter;
  });

  // ── Handlers ───────────────────────────────────────

  const handleAddCategory = () => {
    setShowCategoryInput(true);
    setNewCategoryName("");
  };

  const handleSaveCategory = async () => {
    const trimmed = newCategoryName.trim();
    
    if (!trimmed) {
      showAlert("Please enter a category name", "Invalid Input", "error");
      return;
    }

    if (categories.includes(trimmed)) {
      showAlert("Category already exists", "Duplicate Category", "error");
      return;
    }

    const newCategory: Category = {
      id: generateUUID(),
      name: trimmed,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await saveCategory(newCategory);
    setCategories(prev => [...prev, trimmed]);
    setShowCategoryInput(false);
    setNewCategoryName("");
    
    // Sync in background
    syncWithServer().catch(err => console.error("Background sync failed:", err));
  };

  const handleCreateSet = () => {
    setNewSetTitle("");
    setNewSetCategory("");
    setShowCreateModal(true);
  };

  const handleCreateSetSubmit = async () => {
    if (!newSetTitle.trim()) {
      showAlert("Please enter a title", "Invalid Input", "error");
      return;
    }

    try {
      const categoryToUse = (newSetCategory && newSetCategory.trim()) ? newSetCategory.trim() : "Uncategorized";

      const newSet: FlashcardSet = {
        id: generateUUID(),
        title: newSetTitle.trim(),
        category: categoryToUse,
        cards: [],
        createdAt: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_deleted: false,
        source: 'created' // Mark as user-created
      };

      await saveSet(newSet);
      setSets(prev => [...prev, newSet]);
      setShowCreateModal(false);
      setNewSetTitle("");
      setNewSetCategory("");
      
      // Sync in background
      syncWithServer().catch(err => console.error("Background sync failed:", err));
      
      // Navigate to the new set's detail page
      navigate(`/set/${newSet.id}`);
    } catch (error) {
      console.error("Error creating set:", error);
      showAlert(`Failed to create flashcard set: ${error instanceof Error ? error.message : 'Unknown error'}`, "Error", "error");
    }
  };

  const handleEditSet = (set: FlashcardSet) => {
    setEditingSet(set);
    setNewSetTitle(set.title);
    setNewSetCategory(set.category || "");
    setShowEditModal(true);
  };

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
        updated_at: new Date().toISOString()
      };

      await saveSet(updated);
      setSets(prev => prev.map(s => s.id === editingSet.id ? updated : s));
      setShowEditModal(false);
      setEditingSet(null);
      setNewSetTitle("");
      setNewSetCategory("");
      
      // Sync in background
      syncWithServer().catch(err => console.error("Background sync failed:", err));
    } catch (error) {
      console.error("Error updating set:", error);
      showAlert("Failed to update flashcard set. Please try again.", "Error", "error");
    }
  };

  const handleDeleteSet = async (id: string) => {
    showConfirm(
      "Delete this set and all its cards?",
      async () => {
        await deleteSet(id);
        setSets(prev => prev.filter(s => s.id !== id));
        
        // Also remove from shared sets if present
        setSharedSets(prev => prev.filter(s => s.id !== id));
        
        // Sync in background
        syncWithServer().catch(err => console.error("Background sync failed:", err));
      },
      "Confirm Delete"
    );
  };

  const handleShareSet = (set: FlashcardSet) => {
    setSharingSetId(set.id);
    setSharingSetTitle(set.title);
    setShowShareModal(true);
  };

  const handleViewSharedSet = (sharedSet: DisplaySharedSet) => {
    if (sharedSet.source === 'internet' && sharedSet.share_code) {
      // Navigate to internet shared set view
      navigate(`/share/${sharedSet.share_code}`);
    } else {
      // Navigate to local set view
      navigate(`/set/${sharedSet.id}`);
    }
  };

  const getSourceIcon = (source: DisplaySharedSet['source']) => {
    switch (source) {
      case 'internet': return '🌐';
      case 'imported': return '📁';
      case 'qr_scanned': return '📷';
      case 'bluetooth': return '📡';
      default: return '📚';
    }
  };

  const getSourceLabel = (source: DisplaySharedSet['source']) => {
    switch (source) {
      case 'internet': return 'Internet Share';
      case 'imported': return 'File Import';
      case 'qr_scanned': return 'QR Scanned';
      case 'bluetooth': return 'Bluetooth';
      default: return 'Shared';
    }
  };

  // ── Render ─────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <h1 className="text-2xl sm:text-3xl font-bold text-indigo-600 dark:text-indigo-400">
              FlashQuiz
            </h1>

            {/* Desktop User Area */}
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
                  logout();
                  navigate("/login");
                }}
                className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors text-sm"
              >
                Logout
              </button>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>

          {/* Mobile Menu */}
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
        {/* Filter Bar */}
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
                    ? "bg-indigo-600 text-white shadow-md"
                    : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                {f}
              </button>
            ))}
            <button
              onClick={handleAddCategory}
              className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium bg-green-500 hover:bg-green-600 text-white transition-colors"
            >
              + Category
            </button>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="mb-6 flex flex-col sm:flex-row flex-wrap gap-3 justify-end">
          <button
            onClick={() => setShowFileUpload(true)}
            className="px-4 py-2.5 sm:px-6 sm:py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all text-sm sm:text-base"
          >
            🤖 Generate from File
          </button>
          <button
            onClick={() => setShowReceiveBluetooth(true)}
            className="px-4 py-2.5 sm:px-6 sm:py-3 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all text-sm sm:text-base"
          >
            📡 Receive Shared Set
          </button>
          <button
            onClick={handleCreateSet}
            className="px-4 py-2.5 sm:px-6 sm:py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all text-sm sm:text-base"
          >
            + New Set
          </button>
        </div>

        {/* My Sets List */}
        <section className="mb-8">
          <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
            My Flashcard Sets ({filteredSets.length})
          </h2>

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
                  <div
                    onClick={() => navigate(`/set/${set.id}`)}
                    className="cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white break-words flex-1">
                        {set.title}
                      </h3>
                      {set.generated_from_file && (
                        <span className="ml-2 text-xl flex-shrink-0" title="Generated from file">
                          🤖
                        </span>
                      )}
                    </div>
                    
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-3">
                      {set.category || "Uncategorized"} • {set.cards.length} cards •{" "}
                      {new Date(set.createdAt).toLocaleDateString()}
                    </p>
                    
                    {set.source_filename && (
                      <p className="text-xs text-indigo-600 dark:text-indigo-400 mb-3">
                        📄 From: {set.source_filename}
                      </p>
                    )}
                    
                    {/* Last Studied Badge */}
                    {set.last_studied_at && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                        Last studied: {new Date(set.last_studied_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  
                  {/* Compact Progress Stats */}
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
                  
                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleShareSet(set);
                      }}
                      className="text-blue-600 dark:text-blue-400 hover:underline text-xs sm:text-sm font-medium"
                    >
                      Share
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleEditSet(set);
                      }}
                      className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs sm:text-sm font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleDeleteSet(set.id);
                      }}
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

        {/* Shared by Peers */}
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 dark:text-gray-200">
              Shared by Peers ({sharedSets.length})
            </h2>
            <button
              onClick={() => loadSharedSets()}
              disabled={loadingSharedSets}
              className="px-3 py-1.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg text-sm font-medium hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors disabled:opacity-50"
            >
              {loadingSharedSets ? "Refreshing..." : "🔄 Refresh"}
            </button>
          </div>

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
                  key={`${shared.source}-${shared.id}`}
                  className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-lg shadow-md hover:shadow-xl transition-all p-4 sm:p-5 border border-indigo-100 dark:border-indigo-800"
                >
                  <div
                    onClick={() => handleViewSharedSet(shared)}
                    className="cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-1 break-words flex-1">
                        {shared.title}
                      </h3>
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
                  
                  <div className="pt-3 border-t border-indigo-200 dark:border-indigo-700 flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewSharedSet(shared);
                      }}
                      className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      View Set →
                    </button>
                    {shared.source !== 'internet' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSet(shared.id);
                        }}
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

      {/* Create Set Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto animate-slide-up">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Create New Flashcard Set
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
                onClick={() => {
                  setShowCreateModal(false);
                  setNewSetTitle("");
                  setNewSetCategory("");
                }}
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

      {/* Edit Set Modal */}
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
                onClick={() => {
                  setShowEditModal(false);
                  setEditingSet(null);
                  setNewSetTitle("");
                  setNewSetCategory("");
                }}
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

      {/* Add Category Modal */}
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
                  if (e.key === 'Enter') {
                    handleSaveCategory();
                  }
                }}
              />
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowCategoryInput(false);
                  setNewCategoryName("");
                }}
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

      {/* Share Modal */}
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

      {/* Receive Bluetooth Modal */}
      {showReceiveBluetooth && (
        <ReceiveBluetoothModal
          onClose={() => setShowReceiveBluetooth(false)}
        />
      )}

      {/* File Upload Modal */}
      {showFileUpload && (
        <FileUploadModal
          categories={categories}
          onClose={() => setShowFileUpload(false)}
          onSuccess={handleFileUploadSuccess}
        />
      )}

      {/* Custom Modal */}
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