/* eslint-disable @typescript-eslint/no-unused-vars */
// src/pages/SetDetail.tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getCurrentUser, logout } from "../services/auth";
import { syncWithServer } from "../services/sync";
import { getSetById, saveSet } from "../utils/db";
import CustomModal from "./CustomModal";
import { useModal } from "../hooks/useModal";
import { SetProgressStats } from "./SetProgressStats";
import { updateSetProgress, getLatestQuizSession, type QuizSessionData } from "../services/progress";

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

export default function SetDetail() {
  const navigate = useNavigate();
  const { setId } = useParams<{ setId: string }>();
  const { modalState, showAlert, showConfirm, closeModal } = useModal();
  
  const [user, setUser] = useState<User | null>(null);
  const [flashcardSet, setFlashcardSet] = useState<FlashcardSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Edit mode states
  const [isEditing, setIsEditing] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  
  // Add card modal
  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");

  const [refreshingProgress, setRefreshingProgress] = useState(false);

  // ✅ NEW: Latest quiz session state
  const [latestQuizSession, setLatestQuizSession] = useState<QuizSessionData['quiz_session'] | null>(null);
  const [loadingLatestQuiz, setLoadingLatestQuiz] = useState(false);

  useEffect(() => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      navigate("/login", { replace: true });
      return;
    }
    setUser(currentUser);
    loadSet();
  }, [navigate, setId]);

  const loadSet = async () => {
    if (!setId) {
      setLoading(false);
      return;
    }

    try {
      const set = await getSetById(setId);
      if (set) {
        setFlashcardSet(set);
        // ✅ Load latest quiz session after loading set
        await loadLatestQuizSession(setId);
      } else {
        // Set not found in local DB, trigger sync
        await syncWithServer();
        const syncedSet = await getSetById(setId);
        if (syncedSet) {
          setFlashcardSet(syncedSet);
          // ✅ Load latest quiz session after sync
          await loadLatestQuizSession(setId);
        }
      }
    } catch (err) {
      console.error("Error loading set:", err);
    } finally {
      setLoading(false);
    }
  };

  // ✅ NEW: Load latest quiz session
  const loadLatestQuizSession = async (setId: string) => {
    setLoadingLatestQuiz(true);
    try {
      const quizData = await getLatestQuizSession(setId);
      if (quizData.has_quiz_session && quizData.quiz_session) {
        setLatestQuizSession(quizData.quiz_session);
        console.log("Loaded latest quiz session:", quizData.quiz_session);
      } else {
        setLatestQuizSession(null);
      }
    } catch (error) {
      console.error("Failed to fetch latest quiz session:", error);
      setLatestQuizSession(null);
    } finally {
      setLoadingLatestQuiz(false);
    }
  };

  const handleAddCard = async () => {
    if (!flashcardSet || !newQuestion.trim() || !newAnswer.trim()) {
      showAlert("Please enter both question and answer", "Invalid Input", "error");
      return;
    }

    const newCard: Flashcard = {
      id: generateUUID(),
      question: newQuestion.trim(),
      answer: newAnswer.trim(),
      position: flashcardSet.cards.length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_deleted: false
    };

    const updatedSet = {
      ...flashcardSet,
      cards: [...flashcardSet.cards, newCard],
      updated_at: new Date().toISOString()
    };

    setSaving(true);
    try {
      await saveSet(updatedSet);
      setFlashcardSet(updatedSet);
      setShowAddCardModal(false);
      setNewQuestion("");
      setNewAnswer("");
      
      // Sync in background
      syncWithServer().catch(err => console.error("Background sync failed:", err));
      
      showAlert("Card added successfully!", "Success", "success");
    } catch (error) {
      console.error("Error adding card:", error);
      showAlert("Failed to add card. Please try again.", "Error", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleEditCard = (card: Flashcard) => {
    setEditingCardId(card.id);
    setEditQuestion(card.question);
    setEditAnswer(card.answer);
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!flashcardSet || !editingCardId || !editQuestion.trim() || !editAnswer.trim()) {
      showAlert("Please enter both question and answer", "Invalid Input", "error");
      return;
    }

    const updatedCards = flashcardSet.cards.map(card =>
      card.id === editingCardId
        ? {
            ...card,
            question: editQuestion.trim(),
            answer: editAnswer.trim(),
            updated_at: new Date().toISOString()
          }
        : card
    );

    const updatedSet = {
      ...flashcardSet,
      cards: updatedCards,
      updated_at: new Date().toISOString()
    };

    setSaving(true);
    try {
      await saveSet(updatedSet);
      setFlashcardSet(updatedSet);
      setIsEditing(false);
      setEditingCardId(null);
      setEditQuestion("");
      setEditAnswer("");
      
      // Sync in background
      syncWithServer().catch(err => console.error("Background sync failed:", err));
      
      showAlert("Card updated successfully!", "Success", "success");
    } catch (error) {
      console.error("Error updating card:", error);
      showAlert("Failed to update card. Please try again.", "Error", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    if (!flashcardSet) return;

    showConfirm(
      "Delete this card?",
      async () => {
        const updatedCards = flashcardSet.cards.map(card =>
          card.id === cardId
            ? { ...card, is_deleted: true, updated_at: new Date().toISOString() }
            : card
        );

        const updatedSet = {
          ...flashcardSet,
          cards: updatedCards.filter(c => !c.is_deleted),
          updated_at: new Date().toISOString()
        };

        setSaving(true);
        try {
          await saveSet(updatedSet);
          setFlashcardSet(updatedSet);
          
          // Sync in background
          syncWithServer().catch(err => console.error("Background sync failed:", err));
          
          showAlert("Card deleted successfully!", "Success", "success");
        } catch (error) {
          console.error("Error deleting card:", error);
          showAlert("Failed to delete card. Please try again.", "Error", "error");
        } finally {
          setSaving(false);
        }
      },
      "Confirm Delete"
    );
  };

  const handleRefreshProgress = async () => {
    if (!flashcardSet) return;
    
    setRefreshingProgress(true);
    try {
      const response = await updateSetProgress(flashcardSet.id);
      
      // Update the local state with new progress data
      setFlashcardSet(response.flashcard_set);
      
      // ✅ Also refresh latest quiz session
      await loadLatestQuizSession(flashcardSet.id);
      
      showAlert("Progress updated successfully!", "Success", "success");
    } catch (error) {
      console.error("Error refreshing progress:", error);
      showAlert("Failed to update progress. Please try again.", "Error", "error");
    } finally {
      setRefreshingProgress(false);
    }
  };

  if (!user) return null;
  
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400 text-lg">Loading...</div>
      </div>
    );
  }

  if (!flashcardSet) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 shadow-md">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <button
              onClick={() => navigate("/")}
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              ← Back to Home
            </button>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 sm:p-8 text-center">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white mb-4">
              Set Not Found
            </h2>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mb-6">
              The flashcard set you're looking for doesn't exist or has been deleted.
            </p>
            <button
              onClick={() => navigate("/")}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
            >
              Go Home
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
              <button
                onClick={() => navigate("/")}
                className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm sm:text-base flex-shrink-0"
              >
                ← Back
              </button>
              <h1 className="text-base sm:text-xl md:text-2xl font-bold text-gray-900 dark:text-white truncate">
                {flashcardSet.title}
              </h1>
            </div>
            <div className="hidden md:flex items-center gap-3 flex-shrink-0">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                @{user.username}
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
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 md:py-8">
        {/* Set Info */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
          <div className="mb-4">
            <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white break-words">
              {flashcardSet.title}
            </h2>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
              {flashcardSet.category || "Uncategorized"} • {flashcardSet.cards.length} cards
            </p>
          </div>
          
          {/* Progress Stats Section - Now includes latest quiz */}
          {flashcardSet.total_cards !== undefined && flashcardSet.total_cards > 0 && (
            <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white">
                  📊 Study Progress
                </h3>
                <button
                  onClick={handleRefreshProgress}
                  disabled={refreshingProgress}
                  className="px-2.5 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg text-xs font-medium hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors disabled:opacity-50"
                >
                  {refreshingProgress ? "Updating..." : "🔄 Refresh"}
                </button>
              </div>
              
              <SetProgressStats
                totalCards={flashcardSet.total_cards || 0}
                masteredCards={flashcardSet.mastered_cards || 0}
                learningCards={flashcardSet.learning_cards || 0}
                newCards={flashcardSet.new_cards || 0}
                overallAccuracy={flashcardSet.overall_accuracy || 0}
                progressPercentage={flashcardSet.progress_percentage || 0}
                lastStudiedAt={flashcardSet.last_studied_at}
                studyTimeSeconds={flashcardSet.total_study_time_seconds}
                latestQuizSession={latestQuizSession}
                mode="study"
                compact={false}
              />
            </div>
          )}
          
          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3">
            <button
              onClick={() => navigate("/study", { state: { set: flashcardSet } })}
              disabled={flashcardSet.cards.length === 0}
              className="px-4 py-2.5 sm:px-6 sm:py-3 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
            >
              📚 Study Mode
            </button>
            <button
              onClick={() => navigate("/quiz", { state: { set: flashcardSet } })}
              disabled={flashcardSet.cards.length === 0}
              className="px-4 py-2.5 sm:px-6 sm:py-3 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
            >
              🎯 Quiz Mode
            </button>
            <button
              onClick={() => setShowAddCardModal(true)}
              className="px-4 py-2.5 sm:px-6 sm:py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all sm:ml-auto text-sm sm:text-base"
            >
              + Add Card
            </button>
          </div>
        </div>

        {/* Cards List */}
        <div className="space-y-3 sm:space-y-4">
          {flashcardSet.cards.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 sm:p-8 text-center">
              <p className="text-gray-500 dark:text-gray-400 italic text-sm sm:text-base">
                No cards yet. Click "Add Card" to get started!
              </p>
            </div>
          ) : (
            flashcardSet.cards.map((card, index) => (
              <div
                key={card.id}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 sm:gap-3 mb-3">
                      <span className="text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">
                        #{index + 1}
                      </span>
                    </div>
                    
                    {editingCardId === card.id ? (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Question
                          </label>
                          <textarea
                            value={editQuestion}
                            onChange={(e) => setEditQuestion(e.target.value)}
                            className="w-full px-3 py-2 sm:px-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm sm:text-base"
                            rows={3}
                          />
                        </div>
                        <div>
                          <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Answer
                          </label>
                          <textarea
                            value={editAnswer}
                            onChange={(e) => setEditAnswer(e.target.value)}
                            className="w-full px-3 py-2 sm:px-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm sm:text-base"
                            rows={3}
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={handleSaveEdit}
                            disabled={saving}
                            className="px-3 py-2 sm:px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors text-sm sm:text-base"
                          >
                            {saving ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={() => {
                              setIsEditing(false);
                              setEditingCardId(null);
                              setEditQuestion("");
                              setEditAnswer("");
                            }}
                            className="px-3 py-2 sm:px-4 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm sm:text-base"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mb-4">
                          <h3 className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Question
                          </h3>
                          <p className="text-sm sm:text-base text-gray-900 dark:text-white break-words whitespace-pre-wrap">
                            {card.question}
                          </p>
                        </div>
                        <div>
                          <h3 className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Answer
                          </h3>
                          <p className="text-sm sm:text-base text-gray-900 dark:text-white break-words whitespace-pre-wrap">
                            {card.answer}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                  
                  {!isEditing && (
                    <div className="flex flex-col gap-2 ml-3 sm:ml-4 flex-shrink-0">
                      <button
                        onClick={() => handleEditCard(card)}
                        className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs sm:text-sm font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteCard(card.id)}
                        className="text-red-600 dark:text-red-400 hover:underline text-xs sm:text-sm font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Add Card Modal */}
      {showAddCardModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-4 sm:p-6 max-h-[90vh] overflow-y-auto animate-slide-up">
            <h3 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Add New Card
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Question *
                </label>
                <textarea
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  placeholder="Enter the question"
                  className="w-full px-3 py-2 sm:px-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm sm:text-base"
                  rows={4}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Answer *
                </label>
                <textarea
                  value={newAnswer}
                  onChange={(e) => setNewAnswer(e.target.value)}
                  placeholder="Enter the answer"
                  className="w-full px-3 py-2 sm:px-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm sm:text-base"
                  rows={4}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowAddCardModal(false);
                  setNewQuestion("");
                  setNewAnswer("");
                }}
                className="flex-1 px-3 py-2 sm:px-4 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm sm:text-base"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCard}
                disabled={saving}
                className="flex-1 px-3 py-2 sm:px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors text-sm sm:text-base"
              >
                {saving ? "Adding..." : "Add Card"}
              </button>
            </div>
          </div>
        </div>
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