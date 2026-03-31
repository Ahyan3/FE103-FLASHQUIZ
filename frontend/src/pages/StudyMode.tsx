/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable react-hooks/purity */
// src/pages/StudyMode.tsx
// ============================================================
// StudyMode Page Component
// ------------------------------------------------------------
// This page handles the flashcard study experience. Users can
// flip through cards one by one, track which cards they've
// studied, save their progress to the backend, and resume
// where they left off using localStorage persistence.
//
// Features:
//   - Randomized card order (shuffled on load)
//   - Card flip animation (3D CSS transform)
//   - Progress tracking per card (studied/unseen)
//   - Auto-save to backend on each card flip
//   - LocalStorage fallback for offline progress resumption
//   - Completion detection and final save on session end
// ============================================================

import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { recordStudySession, type CardResult } from "../services/progress";
import ProgressBar from "./ProgressBar";

// ============================================================
// Type Definitions
// ============================================================

/** Represents a single flashcard with a question and answer */
interface Flashcard {
  id: string;
  question: string;
  answer: string;
}

/** Represents a full flashcard set with metadata and its cards */
interface FlashcardSet {
  id: string;
  title: string;
  category?: string;
  cards: Flashcard[];
  createdAt: string;
}

// ============================================================
// LocalStorage Key Helper
// ------------------------------------------------------------
// Generates a unique localStorage key per flashcard set so
// multiple sets can each have their own saved study progress.
// ============================================================
const STUDY_PROGRESS_KEY = (setId: string) => `study_progress_${setId}`;

/** Shape of the progress object stored in localStorage */
interface StudyProgress {
  currentIndex: number;        // Which card the user was on
  studied: number[];           // Indices of cards already flipped
  cardResults: CardResult[];   // Array of { card_id, correct } results
  sessionStartTime: number;    // Unix timestamp when session started
  shuffledCardIds: string[];   // Card IDs in the shuffled order
}

// ============================================================
// StudyMode Component
// ============================================================
export default function StudyMode() {
  // ---- Router Hooks ----
  // useNavigate allows programmatic navigation (e.g., back to dashboard)
  // useLocation gives access to state passed via navigate(), which
  // contains the flashcard set data the user wants to study
  const navigate = useNavigate();
  const location = useLocation();
  const set: FlashcardSet = location.state?.set;

  // ============================================================
  // Load Saved Progress from LocalStorage
  // ------------------------------------------------------------
  // If the user previously studied this set and didn't finish,
  // we restore their exact position, studied cards, and card order.
  // We validate that the saved card IDs still match the current set
  // to avoid issues if cards were added/removed since last session.
  // ============================================================
  const loadSavedProgress = (): StudyProgress | null => {
    if (!set) return null;
    
    try {
      const saved = localStorage.getItem(STUDY_PROGRESS_KEY(set.id));
      if (saved) {
        const progress: StudyProgress = JSON.parse(saved);

        // Ensure every saved card ID still exists in the current set
        const currentCardIds = set.cards.map(c => c.id);
        const savedCardsValid = progress.shuffledCardIds.every(id => currentCardIds.includes(id));
        
        if (savedCardsValid) {
          return progress; // Safe to restore
        }
        // If cards changed, fall through and start fresh
      }
    } catch (error) {
      console.error("Error loading saved progress:", error);
    }
    return null;
  };

  // Attempt to restore progress from a previous session
  const savedProgress = loadSavedProgress();

  // ============================================================
  // Initial Card Order
  // ------------------------------------------------------------
  // If we have saved progress, restore the exact shuffled order
  // the user was using. Otherwise, shuffle the cards randomly
  // so each session feels different.
  // ============================================================
  const shuffledCardsInitial = savedProgress
    ? savedProgress.shuffledCardIds
        .map(id => set.cards.find(c => c.id === id)!)
        .filter(Boolean) // Remove any undefined (just in case)
    : set?.cards
    ? [...set.cards].sort(() => Math.random() - 0.5) // Fisher-Yates-like shuffle
    : [];

  // ============================================================
  // Component State
  // ============================================================

  /** The current shuffled order of flashcards */
  const [shuffledCards, setShuffledCards] = useState<Flashcard[]>(shuffledCardsInitial);

  /** Index of the card currently being shown */
  const [currentIndex, setCurrentIndex] = useState(savedProgress?.currentIndex || 0);

  /** Whether the current card is showing the answer side */
  const [isFlipped, setIsFlipped] = useState(false);

  /**
   * Set of card indices the user has already flipped (viewed the answer).
   * Used to track progress and determine session completion.
   */
  const [studied, setStudied] = useState<Set<number>>(
    new Set(savedProgress?.studied || [])
  );

  // ---- Progress Tracking ----

  /** Unix timestamp for when this study session started */
  const [sessionStartTime] = useState<number>(
    savedProgress?.sessionStartTime || Date.now()
  );

  /**
   * Array of { card_id, correct } results sent to the backend.
   * Currently all flipped cards are marked correct since this is
   * a passive study mode (not a quiz).
   */
  const [cardResults, setCardResults] = useState<CardResult[]>(
    savedProgress?.cardResults || []
  );

  /** Whether a backend save request is currently in-flight */
  const [savingProgress, setSavingProgress] = useState(false);

  // ---- Refs for dynamic content height detection ----
  const questionRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  /**
   * Tracks whether the question text overflows the card.
   * If true, we align the text to the top instead of center
   * so the user can scroll through long questions.
   */
  const [isLongQuestion, setIsLongQuestion] = useState(false);

  /** Same as isLongQuestion but for the answer side */
  const [isLongAnswer, setIsLongAnswer] = useState(false);

  // ============================================================
  // Effect: Detect Long Content
  // ------------------------------------------------------------
  // After rendering a new card (or flipping), check if the
  // question/answer text overflows its container. If it does,
  // switch from centered to top-aligned layout and scroll to top.
  // ============================================================
  useEffect(() => {
    if (questionRef.current) {
      const el = questionRef.current;
      setIsLongQuestion(el.scrollHeight > el.clientHeight);
      if (el.scrollHeight > el.clientHeight) el.scrollTop = 0;
    }
    if (answerRef.current) {
      const el = answerRef.current;
      setIsLongAnswer(el.scrollHeight > el.clientHeight);
      if (el.scrollHeight > el.clientHeight) el.scrollTop = 0;
    }
  }, [currentIndex, isFlipped]);

  // ============================================================
  // Save Progress to LocalStorage
  // ------------------------------------------------------------
  // Persists the current study state so users can resume later.
  // Saves card order, current position, results, and start time.
  // ============================================================
  const saveProgressToLocal = () => {
    if (!set) return;
    
    const progress: StudyProgress = {
      currentIndex,
      studied: Array.from(studied),  // Convert Set to array for JSON serialization
      cardResults,
      sessionStartTime,
      shuffledCardIds: shuffledCards.map(c => c.id)
    };
    
    try {
      localStorage.setItem(STUDY_PROGRESS_KEY(set.id), JSON.stringify(progress));
    } catch (error) {
      console.error("Error saving progress:", error);
    }
  };

  // Auto-save to localStorage whenever study state changes
  useEffect(() => {
    saveProgressToLocal();
  }, [currentIndex, studied, cardResults]);

  // ============================================================
  // Clear Saved Progress
  // ------------------------------------------------------------
  // Called after a session is completed or manually reset.
  // Removes the localStorage entry so next visit starts fresh.
  // ============================================================
  const clearSavedProgress = () => {
    if (!set) return;
    try {
      localStorage.removeItem(STUDY_PROGRESS_KEY(set.id));
    } catch (error) {
      console.error("Error clearing progress:", error);
    }
  };

  // ============================================================
  // Guard: Empty Set
  // ------------------------------------------------------------
  // If no set was passed via navigation state, or the set has
  // no cards, show a friendly fallback UI instead of crashing.
  // ============================================================
  if (!set || set.cards.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 sm:p-8 text-center max-w-md">
          <p className="text-sm sm:text-base text-gray-700 dark:text-gray-300 mb-4">
            No cards available to study.
          </p>
          <button
            onClick={() => navigate("/dashboard")}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors text-sm sm:text-base"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ---- Derived Values ----

  /** The flashcard currently displayed to the user */
  const currentCard = shuffledCards[currentIndex];

  /**
   * Overall study completion percentage (0–100).
   * Based on how many unique cards have been flipped.
   */
  const progress = ((studied.size / shuffledCards.length) * 100);

  // ============================================================
  // Navigation Handlers
  // ============================================================

  /** Move to the next card (if not already on the last card) */
  const handleNext = () => {
    if (currentIndex < shuffledCards.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setIsFlipped(false); // Always show question side first
    }
  };

  /** Move to the previous card (if not already on the first card) */
  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setIsFlipped(false); // Always show question side first
    }
  };

  // ============================================================
  // Handle Card Flip
  // ------------------------------------------------------------
  // When the user flips a card for the first time:
  //   1. Mark the card index as "studied"
  //   2. Record a CardResult (correct: true) for this card
  //   3. Save the session progress to the backend immediately
  //
  // If they flip it back (answer → question), we just toggle
  // the visual state without recording again.
  // ============================================================
  const handleFlip = async () => {
    if (!isFlipped) {
      // --- First time flipping this card ---

      // Add to studied set (use functional update to avoid stale closure)
      const newStudied = new Set(studied).add(currentIndex);
      setStudied(newStudied);
      
      // Record result for this card — in study mode, viewing = correct
      // (Duplicates are replaced to avoid double-counting the same card)
      const newCardResults = [
        ...cardResults.filter(r => r.card_id !== currentCard.id),
        { card_id: currentCard.id, correct: true }
      ];
      setCardResults(newCardResults);
      
      // --- Backend Save ---
      // Save incrementally after each flip so progress isn't lost
      // if the user closes the app before completing the session.
      setSavingProgress(true);
      try {
        const sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
        
        await recordStudySession(set.id, {
          study_time_seconds: sessionDuration,
          card_results: newCardResults
        });
        
        console.log("Progress saved after flipping card");
      } catch (error) {
        // Non-fatal: localStorage still has the progress as backup
        console.error("Failed to save progress:", error);
      } finally {
        setSavingProgress(false);
      }
    }

    // Toggle the flip animation regardless of first-flip or re-flip
    setIsFlipped(!isFlipped);
  };

  // ============================================================
  // Handle Reset
  // ------------------------------------------------------------
  // Clears all progress and reshuffles the cards. Useful when
  // the user wants to practice again from scratch.
  // ============================================================
  const handleReset = () => {
    if (set?.cards) {
      // Re-shuffle cards for variety
      setShuffledCards([...set.cards].sort(() => Math.random() - 0.5));
    }
    setCurrentIndex(0);
    setIsFlipped(false);
    setStudied(new Set());
    setCardResults([]);

    // Remove the saved progress so next load starts fresh
    clearSavedProgress();
  };

  // ============================================================
  // Handle Final Save
  // ------------------------------------------------------------
  // Called when the session is complete (all cards studied).
  // Sends the full session data to the backend, then clears
  // the local storage entry since the session is done.
  // ============================================================
  const handleSaveProgress = async () => {
    if (cardResults.length === 0) return; // Nothing to save
    
    setSavingProgress(true);
    try {
      const sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
      
      await recordStudySession(set.id, {
        study_time_seconds: sessionDuration,
        card_results: cardResults
      });
      
      console.log("Final progress saved successfully");
      
      // Clean up localStorage after successful backend save
      clearSavedProgress();
    } catch (error) {
      console.error("Failed to save progress:", error);
    } finally {
      setSavingProgress(false);
    }
  };

  /**
   * The session is considered complete when every card in the
   * shuffled deck has been flipped at least once.
   */
  const isComplete = studied.size === shuffledCards.length;

  // ============================================================
  // Effect: Auto-Save on Completion
  // ------------------------------------------------------------
  // When the user flips the last unseen card, automatically
  // trigger the final save without requiring a button click.
  // ============================================================
  useEffect(() => {
    if (isComplete && cardResults.length > 0) {
      handleSaveProgress();
    }
  }, [isComplete]);

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      
      {/* ---- Header ---- */}
      <header className="bg-white dark:bg-gray-800 shadow-md">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Back button — progress is already saved incrementally */}
            <button
              onClick={() => navigate(`/set/${set.id}`)}
              className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="font-medium text-sm sm:text-base">Back</span>
            </button>

            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
              Study Mode
            </h1>

            {/* Spacer to keep title centered */}
            <div className="w-16 sm:w-20"></div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        
        {/* ---- Set Title & Metadata ---- */}
        <div className="text-center mb-4 sm:mb-6">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-2 break-words px-2">
            {set.title}
          </h2>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
            {set.category || "Uncategorized"} • {shuffledCards.length} cards
          </p>
        </div>

        {/* ---- Progress Bar ---- */}
        {/* Shows how many cards have been flipped out of the total */}
        <div className="mb-6 sm:mb-8">
          <ProgressBar percentage={progress} showLabel={true} size="md" color="purple" />
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs sm:text-sm font-medium text-indigo-600 dark:text-indigo-400">
              {studied.size} / {shuffledCards.length} cards studied (flipped)
            </span>
            {/* Show saving indicator while backend request is in-flight */}
            {savingProgress && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                💾 Saving...
              </span>
            )}
          </div>
        </div>

        {/* ---- Flashcard (3D Flip) ---- */}
        {/*
          The card uses CSS 3D transforms to simulate a flip animation.
          - perspective-1000 on the container creates the 3D depth effect
          - transform-style: preserve-3d allows children to exist in 3D space
          - The front face is the default (rotateY 0deg)
          - The back face starts at rotateY(180deg) and uses backface-visibility: hidden
            so it's invisible until the card is flipped
        */}
        <div className="mb-6 sm:mb-8 perspective-1000">
          <div
            onClick={handleFlip}
            className="relative w-full min-h-[250px] sm:min-h-[350px] md:min-h-[400px] max-h-[55vh] sm:max-h-[60vh] cursor-pointer transition-transform duration-500 transform-style-3d"
            style={{
              transformStyle: "preserve-3d",
              transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
            }}
          >
            {/* -- Front Face (Question) -- */}
            <div
              className="absolute inset-0 bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl shadow-2xl p-4 sm:p-6 md:p-8 flex flex-col backface-hidden overflow-hidden"
              style={{ backfaceVisibility: "hidden" }}
            >
              <div className="text-xs sm:text-sm font-semibold text-indigo-600 dark:text-indigo-400 mb-3 sm:mb-4 text-center flex-shrink-0">
                QUESTION
              </div>
              {/* Scrollable question area — aligns to top if content is long */}
              <div
                ref={questionRef}
                className={`flex-1 flex flex-col overflow-auto px-2 sm:px-4 scrollbar-thin ${
                  isLongQuestion ? "justify-start" : "justify-center"
                }`}
                key={currentIndex} // Reset scroll position when card changes
              >
                <p className="text-base sm:text-lg md:text-xl lg:text-2xl xl:text-3xl font-semibold text-gray-900 dark:text-white text-center break-words whitespace-pre-wrap">
                  {currentCard.question}
                </p>
              </div>
              <div className="mt-3 sm:mt-4 md:mt-6 text-xs sm:text-sm text-gray-500 dark:text-gray-400 text-center flex-shrink-0">
                Tap to reveal answer
              </div>
            </div>

            {/* -- Back Face (Answer) -- */}
            {/* Uses a gradient background to visually distinguish from the front */}
            <div
              className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl sm:rounded-2xl shadow-2xl p-4 sm:p-6 md:p-8 flex flex-col backface-hidden overflow-hidden"
              style={{
                backfaceVisibility: "hidden",
                transform: "rotateY(180deg)", // Pre-rotated so it's hidden by default
              }}
            >
              <div className="text-xs sm:text-sm font-semibold text-white/90 mb-3 sm:mb-4 text-center flex-shrink-0">
                ANSWER
              </div>
              {/* Scrollable answer area — aligns to top if content is long */}
              <div
                ref={answerRef}
                className={`flex-1 flex flex-col overflow-auto px-2 sm:px-4 scrollbar-thin ${
                  isLongAnswer ? "justify-start" : "justify-center"
                }`}
                key={currentIndex} // Reset scroll position when card changes
              >
                <p className="text-base sm:text-lg md:text-xl lg:text-2xl xl:text-3xl font-semibold text-white text-center break-words whitespace-pre-wrap">
                  {currentCard.answer}
                </p>
              </div>
              <div className="mt-3 sm:mt-4 md:mt-6 text-xs sm:text-sm text-white/80 text-center flex-shrink-0">
                Tap to flip back
              </div>
            </div>
          </div>
        </div>

        {/* ---- Card Navigation Controls ---- */}
        {/* Previous / card counter / Next */}
        <div className="flex items-center justify-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <button
            onClick={handlePrevious}
            disabled={currentIndex === 0} // Disable on first card
            className="p-2.5 sm:p-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-md"
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Current position indicator e.g. "3 / 10" */}
          <div className="text-center min-w-[80px] sm:min-w-[100px]">
            <p className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
              {currentIndex + 1} / {shuffledCards.length}
            </p>
          </div>

          <button
            onClick={handleNext}
            disabled={currentIndex === shuffledCards.length - 1} // Disable on last card
            className="p-2.5 sm:p-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-md"
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* ---- Session Completion Banner ---- */}
        {/* Only visible when every card has been flipped at least once */}
        {isComplete && (
          <div className="bg-green-50 dark:bg-green-900/20 border-2 border-green-500 rounded-lg p-4 sm:p-6 mb-4 sm:mb-6 animate-slide-up">
            <div className="flex items-center justify-center gap-2 sm:gap-3 mb-3 sm:mb-4">
              <svg className="w-6 h-6 sm:w-8 sm:h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="text-base sm:text-xl font-bold text-green-700 dark:text-green-400">
                Great job! You've studied all cards!
              </h3>
            </div>
            {/* Show while final save is in progress */}
            {savingProgress && (
              <p className="text-sm text-green-600 dark:text-green-400 text-center mb-3">
                Saving your progress...
              </p>
            )}
            <div className="flex justify-center gap-3">
              <button
                onClick={() => navigate("/dashboard")}
                className="px-4 py-2 sm:px-6 bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors text-sm sm:text-base"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        )}

        {/* ---- Action Buttons ---- */}
        <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-3">
          {/* Reset reshuffles cards and clears all progress */}
          <button
            onClick={handleReset}
            className="px-4 py-2.5 sm:px-6 sm:py-3 bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all text-sm sm:text-base"
          >
            Reset Progress
          </button>

          {/* Switch to quiz mode — passes the same set via navigation state */}
          <button
            onClick={() => navigate("/quiz", { state: { set } })}
            className="px-4 py-2.5 sm:px-6 sm:py-3 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all text-sm sm:text-base"
          >
            Switch to Quiz Mode
          </button>
        </div>

        {/* ---- Card Index (Jump Navigation) ---- */}
        {/*
          Renders a numbered button grid so the user can jump directly
          to any card. Button colors indicate:
            - Indigo  = currently active card
            - Green   = card has been studied (flipped)
            - Default = card not yet seen
        */}
        <div className="mt-6 sm:mt-8">
          <p className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 text-center">
            Jump to card:
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {shuffledCards.map((_, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setCurrentIndex(idx);
                  setIsFlipped(false); // Always show question side when jumping
                }}
                className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg font-medium transition-all text-xs sm:text-sm ${
                  idx === currentIndex
                    ? "bg-indigo-600 text-white shadow-lg"           // Active card
                    : studied.has(idx)
                    ? "bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200" // Studied
                    : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700" // Unseen
                }`}
              >
                {idx + 1}
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}