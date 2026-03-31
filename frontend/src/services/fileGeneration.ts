// src/services/fileGeneration.ts
import { authFetch } from "./auth";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

export interface FileGenerationJob {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  status: 'processing' | 'completed' | 'failed';
  error_message?: string;
  flashcard_set?: {
    id: string;
    title: string;
    category?: string;
    cards: Array<{
      id: string;
      question: string;
      answer: string;
      position: number;
    }>;
  };
  cards_generated: number;
  created_at: string;
  completed_at?: string;
}

export interface GenerateFromFileResponse {
  job: FileGenerationJob;
  flashcard_set: {
    id: string;
    title: string;
    category?: string;
    generated_from_file: boolean;
    source_filename: string;
    cards: Array<{
      id: string;
      question: string;
      answer: string;
      position: number;
    }>;
  };
  message: string;
}

/**
 * Upload a file and generate flashcards using AI
 */
export async function generateFlashcardsFromFile(
  file: File,
  numCards: number = 20,
  category?: string
): Promise<GenerateFromFileResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('num_cards', numCards.toString());
  if (category) {
    formData.append('category', category);
  }

  const response = await authFetch(`${API_URL}/generate/from-file/`, {
    method: 'POST',
    body: formData,
    // Don't set Content-Type header - browser will set it with boundary for multipart/form-data
    headers: {} // Override default JSON headers
  });

  return response;
}

/**
 * Get all file generation jobs for current user
 */
export async function getGenerationJobs(): Promise<FileGenerationJob[]> {
  const response = await authFetch(`${API_URL}/generate/jobs/`, {
    method: 'GET'
  });

  return response;
}

/**
 * Get details of a specific generation job
 */
export async function getGenerationJobById(jobId: string): Promise<FileGenerationJob> {
  const response = await authFetch(`${API_URL}/generate/jobs/${jobId}/`, {
    method: 'GET'
  });

  return response;
}

/**
 * Validate file before upload
 */
export function validateFile(file: File): { valid: boolean; error?: string } {
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.openxmlformats-officedocument.presentationml.presentation' // .pptx
  ];
  const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.pptx'];

  // Check file size
  if (file.size > MAX_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size is 10MB, but file is ${(file.size / (1024 * 1024)).toFixed(1)}MB`
    };
  }

  // Check file extension
  const fileName = file.name.toLowerCase();
  const hasValidExtension = ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext));
  
  if (!hasValidExtension) {
    return {
      valid: false,
      error: 'Invalid file type. Please upload PDF, DOCX, or PPTX files only.'
    };
  }

  // Check MIME type (if available)
  if (file.type && !ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: 'Invalid file type. Please upload PDF, DOCX, or PPTX files only.'
    };
  }

  return { valid: true };
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get file icon based on file type
 */
export function getFileIcon(fileType: string): string {
  switch (fileType.toLowerCase()) {
    case 'pdf':
      return '📄';
    case 'docx':
      return '📝';
    case 'pptx':
      return '📊';
    default:
      return '📁';
  }
}