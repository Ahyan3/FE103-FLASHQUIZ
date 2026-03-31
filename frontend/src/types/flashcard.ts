// src/types/flashcard.ts

export interface Flashcard {
  id: string;
  question: string;
  answer: string;
  position?: number;
  created_at?: string;
  updated_at?: string;
  is_deleted?: boolean;
}

export interface FlashcardSet {
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
  original_creator?: string;

  // Progress fields
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

export interface Category {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export interface User {
  id: number;
  email: string;
  username: string;
}

// Study and progress related types
export interface StudySession {
  id: string;
  user_id: number;
  flashcard_set_id: string;
  started_at: string;
  completed_at?: string;
  total_cards: number;
  correct_count: number;
  incorrect_count: number;
  created_at?: string;
  updated_at?: string;
  is_deleted?: boolean;
}

export interface CardProgress {
  id: string;
  user_id: number;
  flashcard_id: string;
  study_session_id?: string;
  times_seen: number;
  times_correct: number;
  times_incorrect: number;
  last_reviewed?: string;
  ease_factor: number;
  interval_days: number;
  next_review?: string;
  last_response?: 'again' | 'hard' | 'good' | 'easy';
  created_at?: string;
  updated_at?: string;
  is_deleted?: boolean;
}

export interface SetProgress {
  id: string;
  user_id: number;
  flashcard_set_id: string;
  total_cards_studied: number;
  mastered_cards: number;
  learning_cards: number;
  new_cards: number;
  total_study_time_seconds: number;
  last_studied?: string;
  study_streak_days: number;
  overall_accuracy: number;
  created_at?: string;
  updated_at?: string;
  is_deleted?: boolean;
}