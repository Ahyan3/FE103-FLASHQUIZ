/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable react-hooks/purity */
// src/pages/StudyMode.tsx
import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { recordStudySession, type CardResult } from "../services/progress";
import ProgressBar from "./ProgressBar";

interface Flashcard {
  id: string;
  question: string;
  answer: string;
}

interface FlashcardSet {
  id: string;
  title: string;
  category?: string;
  cards: Flashcard[];
  createdAt: string;
}

// Local storage key for study progress
const STUDY_PROGRESS_KEY = (setId: string) => `study_progress_${setId}`;

interface StudyProgress {
  currentIndex: number;
  studied: number[];
  cardResults: CardResult[];
  sessionStartTime: number;
  shuffledCardIds: string[];
}

export default function StudyMode() {
  const navigate = useNavigate();
  const location = useLocation();
  const set: FlashcardSet = location.state?.set;

  // Load saved progress or initialize
  const loadSavedProgress = (): StudyProgress | null => {
    if (!set) return null;
    
    try {
      const saved = localStorage.getItem(STUDY_PROGRESS_KEY(set.id));
      if (saved) {
        const progress: StudyProgress = JSON.parse(saved);
        // Validate that saved card IDs match current set
        const currentCardIds = set.cards.map(c => c.id);
        const savedCardsValid = progress.shuffledCardIds.every(id => currentCardIds.includes(id));
        
        if (savedCardsValid) {
          return progress;
        }
      }
    } catch (error) {
      console.error("Error loading saved progress:", error);
    }
    return null;
  };

  const savedProgress = loadSavedProgress();

  // Shuffle cards or restore saved order
  const shuffledCardsInitial = savedProgress
    ? savedProgress.shuffledCardIds.map(id => set.cards.find(c => c.id === id)!).filter(Boolean)
    : set?.cards ? [...set.cards].sort(() => Math.random() - 0.5) : [];
  
  const [shuffledCards, setShuffledCards] = useState<Flashcard[]>(shuffledCardsInitial);
  const [currentIndex, setCurrentIndex] = useState(savedProgress?.currentIndex || 0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [studied, setStudied] = useState<Set<number>>(
    new Set(savedProgress?.studied || [])
  );

  // Progress tracking
  const [sessionStartTime] = useState<number>(savedProgress?.sessionStartTime || Date.now());
  const [cardResults, setCardResults] = useState<CardResult[]>(savedProgress?.cardResults || []);
  const [savingProgress, setSavingProgress] = useState(false);

  const questionRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const [isLongQuestion, setIsLongQuestion] = useState(false);
  const [isLongAnswer, setIsLongAnswer] = useState(false);

  // Detect long content for alignment
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

  // Save progress to localStorage whenever it changes
  const saveProgressToLocal = () => {
    if (!set) return;
    
    const progress: StudyProgress = {
      currentIndex,
      studied: Array.from(studied),
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

  // Save progress whenever relevant state changes
  useEffect(() => {
    saveProgressToLocal();
  }, [currentIndex, studied, cardResults]);

  // Clear progress when session completes
  const clearSavedProgress = () => {
    if (!set) return;
    try {
      localStorage.removeItem(STUDY_PROGRESS_KEY(set.id));
    } catch (error) {
      console.error("Error clearing progress:", error);
    }
  };

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

  const currentCard = shuffledCards[currentIndex];
  const progress = ((studied.size / shuffledCards.length) * 100);

  const handleNext = () => {
    if (currentIndex < shuffledCards.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setIsFlipped(false);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setIsFlipped(false);
    }
  };

  // Flip card, mark as studied, and save progress immediately
  const handleFlip = async () => {
    if (!isFlipped) {
      // Mark as studied
      const newStudied = new Set(studied).add(currentIndex);
      setStudied(newStudied);
      
      // Add card result (assuming correct since they viewed it)
      const newCardResults = [
        ...cardResults.filter(r => r.card_id !== currentCard.id),
        { card_id: currentCard.id, correct: true }
      ];
      setCardResults(newCardResults);
      
      // Save progress to backend immediately
      setSavingProgress(true);
      try {
        const sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
        
        await recordStudySession(set.id, {
          study_time_seconds: sessionDuration,
          card_results: newCardResults
        });
        
        console.log("Progress saved after flipping card");
      } catch (error) {
        console.error("Failed to save progress:", error);
      } finally {
        setSavingProgress(false);
      }
    }
    setIsFlipped(!isFlipped);
  };

  const handleReset = () => {
    if (set?.cards) {
      setShuffledCards([...set.cards].sort(() => Math.random() - 0.5));
    }
    setCurrentIndex(0);
    setIsFlipped(false);
    setStudied(new Set());
    setCardResults([]);
    
    // Clear saved progress
    clearSavedProgress();
  };

  // Save final progress when completing
  const handleSaveProgress = async () => {
    if (cardResults.length === 0) return;
    
    setSavingProgress(true);
    try {
      const sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
      
      await recordStudySession(set.id, {
        study_time_seconds: sessionDuration,
        card_results: cardResults
      });
      
      console.log("Final progress saved successfully");
      
      // Clear local storage after successful save
      clearSavedProgress();
    } catch (error) {
      console.error("Failed to save progress:", error);
    } finally {
      setSavingProgress(false);
    }
  };

  // Updated: show completion message whenever all cards are studied
  const isComplete = studied.size === shuffledCards.length;

  // Save progress when completing
  useEffect(() => {
    if (isComplete && cardResults.length > 0) {
      handleSaveProgress();
    }
  }, [isComplete]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-md">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                // Progress is already saved on each card flip
                navigate(`/set/${set.id}`);
              }}
              className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              <span className="font-medium text-sm sm:text-base">Back</span>
            </button>
            <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
              Study Mode
            </h1>
            <div className="w-16 sm:w-20"></div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Set Info */}
        <div className="text-center mb-4 sm:mb-6">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-2 break-words px-2">
            {set.title}
          </h2>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
            {set.category || "Uncategorized"} • {shuffledCards.length} cards
          </p>
        </div>

        {/* Progress Bar */}
        <div className="mb-6 sm:mb-8">
          <ProgressBar
            percentage={progress}
            showLabel={true}
            size="md"
            color="purple"
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs sm:text-sm font-medium text-indigo-600 dark:text-indigo-400">
              {studied.size} / {shuffledCards.length} cards studied (flipped)
            </span>
            {savingProgress && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                💾 Saving...
              </span>
            )}
          </div>
        </div>

        {/* Flashcard */}
        <div className="mb-6 sm:mb-8 perspective-1000">
          <div
            onClick={handleFlip}
            className={`relative w-full min-h-[250px] sm:min-h-[350px] md:min-h-[400px] max-h-[55vh] sm:max-h-[60vh] cursor-pointer transition-transform duration-500 transform-style-3d`}
            style={{
              transformStyle: "preserve-3d",
              transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
            }}
          >
            {/* Front */}
            <div
              className="absolute inset-0 bg-white dark:bg-gray-800 rounded-xl sm:rounded-2xl shadow-2xl p-4 sm:p-6 md:p-8 flex flex-col backface-hidden overflow-hidden"
              style={{ backfaceVisibility: "hidden" }}
            >
              <div className="text-xs sm:text-sm font-semibold text-indigo-600 dark:text-indigo-400 mb-3 sm:mb-4 text-center flex-shrink-0">
                QUESTION
              </div>
              <div
                ref={questionRef}
                className={`flex-1 flex flex-col overflow-auto px-2 sm:px-4 scrollbar-thin ${
                  isLongQuestion ? "justify-start" : "justify-center"
                }`}
                key={currentIndex}
              >
                <p className="text-base sm:text-lg md:text-xl lg:text-2xl xl:text-3xl font-semibold text-gray-900 dark:text-white text-center break-words whitespace-pre-wrap">
                  {currentCard.question}
                </p>
              </div>
              <div className="mt-3 sm:mt-4 md:mt-6 text-xs sm:text-sm text-gray-500 dark:text-gray-400 text-center flex-shrink-0">
                Tap to reveal answer
              </div>
            </div>

            {/* Back */}
            <div
              className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl sm:rounded-2xl shadow-2xl p-4 sm:p-6 md:p-8 flex flex-col backface-hidden overflow-hidden"
              style={{
                backfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
            >
              <div className="text-xs sm:text-sm font-semibold text-white/90 mb-3 sm:mb-4 text-center flex-shrink-0">
                ANSWER
              </div>
              <div
                ref={answerRef}
                className={`flex-1 flex flex-col overflow-auto px-2 sm:px-4 scrollbar-thin ${
                  isLongAnswer ? "justify-start" : "justify-center"
                }`}
                key={currentIndex}
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

        {/* Navigation */}
        <div className="flex items-center justify-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <button
            onClick={handlePrevious}
            disabled={currentIndex === 0}
            className="p-2.5 sm:p-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-md"
          >
            <svg
              className="w-5 h-5 sm:w-6 sm:h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <div className="text-center min-w-[80px] sm:min-w-[100px]">
            <p className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
              {currentIndex + 1} / {shuffledCards.length}
            </p>
          </div>

          <button
            onClick={handleNext}
            disabled={currentIndex === shuffledCards.length - 1}
            className="p-2.5 sm:p-3 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-md"
          >
            <svg
              className="w-5 h-5 sm:w-6 sm:h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>

        {/* Completion Message */}
        {isComplete && (
          <div className="bg-green-50 dark:bg-green-900/20 border-2 border-green-500 rounded-lg p-4 sm:p-6 mb-4 sm:mb-6 animate-slide-up">
            <div className="flex items-center justify-center gap-2 sm:gap-3 mb-3 sm:mb-4">
              <svg
                className="w-6 h-6 sm:w-8 sm:h-8 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h3 className="text-base sm:text-xl font-bold text-green-700 dark:text-green-400">
                Great job! You've studied all cards!
              </h3>
            </div>
            {savingProgress && (
              <p className="text-sm text-green-600 dark:text-green-400 text-center mb-3">
                Saving your progress...
              </p>
            )}
            <div className="flex justify-center gap-3">
              <button
                onClick={() => {
                  // Progress is already saved, just navigate
                  navigate("/dashboard");
                }}
                className="px-4 py-2 sm:px-6 bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors text-sm sm:text-base"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-3">
          <button
            onClick={handleReset}
            className="px-4 py-2.5 sm:px-6 sm:py-3 bg-gray-500 hover:bg-gray-600 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all text-sm sm:text-base"
          >
            Reset Progress
          </button>
          <button
            onClick={() => {
              // Progress is already saved on each card flip
              navigate("/quiz", { state: { set } });
            }}
            className="px-4 py-2.5 sm:px-6 sm:py-3 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all text-sm sm:text-base"
          >
            Switch to Quiz Mode
          </button>
        </div>

        {/* Card Index */}
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
                  setIsFlipped(false);
                }}
                className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg font-medium transition-all text-xs sm:text-sm ${
                  idx === currentIndex
                    ? "bg-indigo-600 text-white shadow-lg"
                    : studied.has(idx)
                    ? "bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200"
                    : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
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