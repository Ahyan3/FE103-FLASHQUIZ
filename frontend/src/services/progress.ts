/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/progress.ts

import { authFetch } from "./auth";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

// ==================== Types ====================

export interface CardResult {
  card_id: string;
  correct: boolean;
}

export interface RecordStudySessionRequest {
  study_time_seconds: number;
  card_results: CardResult[];
  session_type?: 'quiz' | 'study';
}

export interface QuizSessionData {
  has_quiz_session: boolean;
  quiz_session?: {
    id: string;
    score: number;
    accuracy: number;
    total_cards: number;
    correct_count: number;
    completed_at: string;
    study_time_seconds: number;
  };
  message?: string;
}

export interface RecordStudySessionResponse {
  message: string;
  session_type: 'quiz' | 'study';
  study_session: any;
  flashcard_set: any;
  progress: {
    total_cards: number;
    mastered_cards: number;
    learning_cards: number;
    new_cards: number;
    overall_accuracy: number;
    progress_percentage: number;
    study_streak_days: number;
    total_study_time_seconds: number;
  };
  quiz_session?: {
    score: number;
    accuracy: number;
    total_cards: number;
  };
}

// ==================== API Functions ====================

/**
 * Record a completed study session
 */
export async function recordStudySession(
  setId: string,
  data: RecordStudySessionRequest
): Promise<RecordStudySessionResponse> {
  return authFetch(`${API_URL}/sets/${setId}/record-session/`, {
    method: "POST",
    body: JSON.stringify(data)
  });
}

/**
 * Get the latest quiz session for a set
 */
export async function getLatestQuizSession(setId: string): Promise<QuizSessionData> {
  return authFetch(`${API_URL}/sets/${setId}/latest-quiz/`, {
    method: "GET"
  });
}

/**
 * Manually update progress for a set
 */
export async function updateSetProgress(setId: string): Promise<any> {
  return authFetch(`${API_URL}/sets/${setId}/update-progress/`, {
    method: "POST"
  });
}

/**
 * Get progress for a specific set
 */
export async function getSetProgress(setId: string): Promise<any> {
  return authFetch(`${API_URL}/sets/${setId}/progress/`, {
    method: "GET"
  });
}

/**
 * Get progress summary for all user's sets
 */
export async function getUserProgress(): Promise<any> {
  return authFetch(`${API_URL}/progress/`, {
    method: "GET"
  });
}