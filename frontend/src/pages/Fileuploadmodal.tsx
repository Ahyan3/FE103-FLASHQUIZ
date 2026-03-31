// src/components/FileUploadModal.tsx
import { useState, useRef } from "react";
import {
  generateFlashcardsFromFile,
  validateFile,
  formatFileSize,
  getFileIcon,
} from "../services/fileGeneration";
import { saveSet } from "../utils/db";
import { syncWithServer } from "../services/sync";

interface FileUploadModalProps {
  categories: string[];
  onClose: () => void;
  onSuccess: (setId: string) => void;
}

export default function FileUploadModal({
  categories,
  onClose,
  onSuccess,
}: FileUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [numCards, setNumCards] = useState(20);
  const [category, setCategory] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const validation = validateFile(selectedFile);
    if (!validation.valid) {
      setError(validation.error || "Invalid file");
      setFile(null);
      return;
    }

    setFile(selectedFile);
    setError("");
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const droppedFile = e.dataTransfer.files[0];
    if (!droppedFile) return;

    const validation = validateFile(droppedFile);
    if (!validation.valid) {
      setError(validation.error || "Invalid file");
      setFile(null);
      return;
    }

    setFile(droppedFile);
    setError("");
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a file");
      return;
    }

    if (numCards < 5 || numCards > 50) {
      setError("Number of cards must be between 5 and 50");
      return;
    }

    setUploading(true);
    setError("");
    setProgress(10); // Initial progress

    try {
      // Simulate progress during upload
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 500);

      const response = await generateFlashcardsFromFile(
        file,
        numCards,
        category || undefined
      );

      clearInterval(progressInterval);
      setProgress(100);

      // Save the generated set to IndexedDB
      const flashcardSet = {
        id: response.flashcard_set.id,
        title: response.flashcard_set.title,
        category: response.flashcard_set.category || "Uncategorized",
        cards: response.flashcard_set.cards.map((card) => ({
          id: card.id,
          question: card.question,
          answer: card.answer,
          position: card.position,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
        })),
        createdAt: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_deleted: false,
        source: "created" as const,
        generated_from_file: true,
        source_filename: file.name,
      };

      await saveSet(flashcardSet);

      // Background sync
      syncWithServer().catch((err) =>
        console.error("Background sync failed:", err)
      );

      // Success - close modal and navigate to the new set
      setTimeout(() => {
        onSuccess(flashcardSet.id);
      }, 500);
    } catch (err: unknown) {
      console.error("Upload error:", err);
      setProgress(0);
      
      if (err && typeof err === 'object' && 'message' in err) {
        setError((err as { message: string }).message);
      } else if (typeof err === 'string') {
        setError(err);
      } else {
        setError("Failed to generate flashcards. Please try again.");
      }
    } finally {
      setUploading(false);
    }
  };

  const getFileType = (fileName: string): string => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    return ext;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            🤖 Generate Flashcards from File
          </h2>
          <button
            onClick={onClose}
            disabled={uploading}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-50"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="space-y-6">
          {/* File Upload Area */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Upload Document (PDF, DOCX, PPTX)
            </label>
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                file
                  ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                  : "border-gray-300 dark:border-gray-600 hover:border-indigo-500 dark:hover:border-indigo-400 hover:bg-gray-50 dark:hover:bg-gray-700/50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.pptx"
                onChange={handleFileSelect}
                className="hidden"
                disabled={uploading}
              />

              {file ? (
                <div className="space-y-2">
                  <div className="text-4xl">{getFileIcon(getFileType(file.name))}</div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {file.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatFileSize(file.size)}
                  </p>
                  {!uploading && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                      }}
                      className="text-xs text-red-600 dark:text-red-400 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-4xl">📁</div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Click to browse or drag & drop your file here
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-500">
                    Maximum file size: 10MB
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Number of Cards */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Number of Cards to Generate
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={numCards}
                onChange={(e) => setNumCards(Number(e.target.value))}
                disabled={uploading}
                className="flex-1"
              />
              <input
                type="number"
                min="5"
                max="50"
                value={numCards}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (val >= 5 && val <= 50) {
                    setNumCards(val);
                  }
                }}
                disabled={uploading}
                className="w-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-center"
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              AI will generate {numCards} flashcards from your document
            </p>
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Category (optional)
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={uploading}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="">Uncategorized</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Progress Bar */}
          {uploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-700 dark:text-gray-300">
                  Generating flashcards...
                </span>
                <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                  {progress}%
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                <div
                  className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                This may take 15-30 seconds depending on document size
              </p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <span className="text-red-600 dark:text-red-400 text-xl">⚠️</span>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">
                    Error
                  </h4>
                  <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Info Box */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="text-blue-600 dark:text-blue-400 text-xl">💡</span>
              <div className="flex-1 text-sm text-blue-800 dark:text-blue-200">
                <p className="font-medium mb-1">How it works:</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Upload a PDF, Word, or PowerPoint document</li>
                  <li>AI extracts text and identifies key concepts</li>
                  <li>Generates high-quality Q&A flashcards automatically</li>
                  <li>Review and edit cards after generation</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={uploading}
              className="flex-1 px-4 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="flex-1 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-md"
            >
              {uploading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Generating...
                </span>
              ) : (
                "🚀 Generate Flashcards"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}