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

