// src/types/progress.ts

export type ResponseType = 'again' | 'hard' | 'good' | 'easy';

export interface CardProgress {
  id: string;
  flashcard_id: string;
  study_session?: string;
  times_seen: number;
  times_correct: number;
  times_incorrect: number;
  last_reviewed?: string;
  ease_factor: number;
  interval_days: number;
  next_review?: string;
  last_response?: ResponseType;
  created_at?: string;
  updated_at?: string;
  is_deleted?: boolean;
}

export interface StudySession {
  id: string;
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

export interface SetProgress {
  id: string;
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