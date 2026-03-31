/* eslint-disable @typescript-eslint/no-unused-vars */
// src/components/SetProgressStats.tsx
import React from 'react';
import ProgressBar from './ProgressBar';

interface SetProgressStatsProps {
  totalCards: number;
  masteredCards: number;
  learningCards: number;
  newCards: number;
  overallAccuracy: number;
  progressPercentage: number;
  lastStudiedAt?: string;
  studyTimeSeconds?: number;
  compact?: boolean;
  mode?: 'study' | 'quiz';
  onReset?: () => void; // Callback to reset progress
  // ✅ Latest quiz session data
  latestQuizSession?: {
    id: string;
    score: number;
    accuracy: number;
    total_cards: number;
    correct_count: number;
    completed_at: string;
    study_time_seconds: number;
  } | null;
}

export const SetProgressStats: React.FC<SetProgressStatsProps> = ({
  totalCards,
  masteredCards,
  learningCards,
  newCards,
  overallAccuracy,
  progressPercentage,
  lastStudiedAt,
  studyTimeSeconds,
  compact = false,
  mode = 'quiz',
  onReset,
  latestQuizSession
}) => {
  const formatStudyTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const formatLastStudied = (dateString?: string): string => {
    if (!dateString) return 'Never';
    
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Calculate cards flipped (for study mode)
  const cardsFlipped = masteredCards + learningCards;

  if (compact) {
    return (
      <div className="flex items-center gap-3 text-xs">
        {/* Show cards flipped for both study and quiz modes */}
        <div className="flex items-center gap-1">
          <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
            {cardsFlipped}
          </span>
          <span className="text-gray-500 dark:text-gray-400">/ {totalCards} cards flipped</span>
        </div>
        
        {/* Show latest quiz score if available */}
        {latestQuizSession && (
          <div className="flex items-center gap-1">
            <span className="text-purple-600 dark:text-purple-400 font-semibold">
              {latestQuizSession.score}/{latestQuizSession.total_cards}
            </span>
            <span className="text-gray-500 dark:text-gray-400">last quiz</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ✅ NEW: Latest Quiz Session Card (shows for both modes if available) */}
      {latestQuizSession && (
        <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-lg p-4 border-2 border-purple-200 dark:border-purple-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🎯</span>
              <h4 className="text-sm font-semibold text-purple-900 dark:text-purple-100">
                Latest Quiz Result
              </h4>
            </div>
            <span className="text-xs text-purple-700 dark:text-purple-300 font-medium">
              {formatLastStudied(latestQuizSession.completed_at)}
            </span>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            {/* Quiz Score */}
            <div className="bg-white dark:bg-purple-900/30 rounded-lg p-3 border border-purple-100 dark:border-purple-800">
              <div className="text-xs font-medium text-purple-700 dark:text-purple-300 mb-1">
                Score
              </div>
              <p className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                {latestQuizSession.score}/{latestQuizSession.total_cards}
              </p>
              <div className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                {latestQuizSession.total_cards > 0 
                  ? ((latestQuizSession.score / latestQuizSession.total_cards) * 100).toFixed(0) 
                  : 0}% correct
              </div>
            </div>
            
            {/* Quiz Time */}
            <div className="bg-white dark:bg-purple-900/30 rounded-lg p-3 border border-purple-100 dark:border-purple-800">
              <div className="text-xs font-medium text-purple-700 dark:text-purple-300 mb-1">
                Quiz Time
              </div>
              <p className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                {formatStudyTime(latestQuizSession.study_time_seconds)}
              </p>
              <div className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                {latestQuizSession.total_cards > 0 
                  ? `${Math.round(latestQuizSession.study_time_seconds / latestQuizSession.total_cards)}s per card`
                  : '0s per card'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Overall Progress - No mode distinction */}
      <div className="grid grid-cols-2 gap-3">
        {/* Cards Studied */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
            Cards Studied
          </div>
          <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
            {cardsFlipped} / {totalCards}
          </p>
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {totalCards > 0 ? ((cardsFlipped / totalCards) * 100).toFixed(0) : 0}% viewed
          </div>
        </div>

        {/* Study Time */}
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
            Study Time
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {studyTimeSeconds !== undefined ? formatStudyTime(studyTimeSeconds) : '0s'}
          </p>
          {lastStudiedAt && (
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              Last: {formatLastStudied(lastStudiedAt)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SetProgressStats;