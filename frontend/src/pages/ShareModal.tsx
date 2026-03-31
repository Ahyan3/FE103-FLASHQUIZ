/* eslint-disable @typescript-eslint/no-unused-vars */
// src/components/ShareModal.tsx - UPDATED WITH PAIRING CODE
import { useState } from "react";
import { initiateBluetoothShare, type BluetoothShare } from "../services/sharing";
import { 
  shareAsFile, 
  generateQRCode,
  isWebShareSupported,
  isFileShareSupported
} from "../utils/offlineSharing";
import { useModal } from "../hooks/useModal";
import CustomModal from "./CustomModal";
import { getSetById } from "../utils/db";

interface ShareModalProps {
  flashcardSetId: string;
  flashcardSetTitle: string;
  onClose: () => void;
}

export default function ShareModal({ flashcardSetId, flashcardSetTitle, onClose }: ShareModalProps) {
  const { modalState, showAlert, closeModal } = useModal();
  const [shareMethod, setShareMethod] = useState<'pairing' | 'file' | 'qr' | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Pairing code share states
  const [pairingSession, setPairingSession] = useState<BluetoothShare | null>(null);
  
  // QR Code state
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');

  const handleCreatePairingCode = async () => {
    setLoading(true);
    try {
      const session = await initiateBluetoothShare({
        flashcard_set_id: flashcardSetId,
      });
      setPairingSession(session);
    } catch (error) {
      console.error("Error creating pairing code:", error);
      showAlert(`Failed to create pairing code: ${error instanceof Error ? error.message : 'Unknown error'}`, "Error", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleShareAsFile = async () => {
    setLoading(true);
    try {
      const flashcardSet = await getSetById(flashcardSetId);
      if (!flashcardSet) {
        throw new Error('Flashcard set not found');
      }
      
      await shareAsFile(flashcardSet);
      showAlert("File shared successfully! Recipient can import it in the app.", "Success", "success");
      onClose();
    } catch (error) {
      console.error("Error sharing file:", error);
      if ((error as Error).message.includes('not supported')) {
        showAlert("File sharing not supported on this device. The file has been downloaded instead.", "Info", "error");
      } else {
        showAlert(`Failed to share file: ${error instanceof Error ? error.message : 'Unknown error'}`, "Error", "error");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateQR = async () => {
    setLoading(true);
    try {
      const flashcardSet = await getSetById(flashcardSetId);
      if (!flashcardSet) {
        throw new Error('Flashcard set not found');
      }
      
      const qr = await generateQRCode(flashcardSet);
      setQrCodeUrl(qr);
    } catch (error) {
      console.error("Error generating QR code:", error);
      showAlert(`${error instanceof Error ? error.message : 'Failed to generate QR code'}`, "Error", "error");
      setShareMethod(null); // Go back to method selection
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    showAlert("Copied to clipboard!", "Success", "success");
  };

  const downloadQRCode = () => {
    const a = document.createElement('a');
    a.href = qrCodeUrl;
    a.download = `${flashcardSetTitle}-QR.png`;
    a.click();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-2xl w-full p-4 sm:p-6 max-h-[90vh] overflow-y-auto scrollbar-thin animate-slide-up">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <h3 className="text-lg sm:text-2xl font-semibold text-gray-900 dark:text-white break-words pr-2">
              Share: {flashcardSetTitle}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex-shrink-0"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Method Selection */}
          {!shareMethod && (
            <div className="space-y-3 sm:space-y-4">
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mb-4 sm:mb-6">
                Choose how you want to share this flashcard set:
              </p>
              
              {/* Pairing Code Option (requires server) */}
              <button
                onClick={() => {
                  setShareMethod('pairing');
                  handleCreatePairingCode();
                }}
                className="w-full p-4 sm:p-6 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-lg shadow-md hover:shadow-lg transition-all text-left"
              >
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="text-3xl sm:text-4xl">🔗</div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-base sm:text-lg font-semibold mb-1">Share via Pairing Code</h4>
                    <p className="text-xs sm:text-sm text-blue-100">
                      Generate 6-digit code for recipient (requires internet)
                    </p>
                  </div>
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* File Share Option (offline) */}
              <button
                onClick={() => setShareMethod('file')}
                className="w-full p-4 sm:p-6 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-lg shadow-md hover:shadow-lg transition-all text-left"
              >
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="text-3xl sm:text-4xl">📁</div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-base sm:text-lg font-semibold mb-1">Share as File</h4>
                    <p className="text-xs sm:text-sm text-green-100">
                      Offline sharing via native share menu (WhatsApp, Bluetooth, etc.)
                    </p>
                  </div>
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* QR Code Option (offline, small sets) */}
              <button
                onClick={() => {
                  setShareMethod('qr');
                  handleGenerateQR();
                }}
                className="w-full p-4 sm:p-6 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white rounded-lg shadow-md hover:shadow-lg transition-all text-left"
              >
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="text-3xl sm:text-4xl">📷</div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-base sm:text-lg font-semibold mb-1">Share via QR Code</h4>
                    <p className="text-xs sm:text-sm text-purple-100">
                      Quick offline share (works best with 10 or fewer cards)
                    </p>
                  </div>
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* Feature indicators */}
              <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-start gap-2 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                  <div className="text-lg">💡</div>
                  <div>
                    <p className="font-medium text-gray-800 dark:text-gray-200 mb-1">Quick Guide:</p>
                    <ul className="space-y-1">
                      <li>🔗 Pairing Code: Simple 6-digit code to share online</li>
                      <li>📁 File: Works offline, use phone's Bluetooth/WhatsApp</li>
                      <li>📷 QR: Instant scan-and-go for small sets</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* File Share Confirmation */}
          {shareMethod === 'file' && (
            <div className="space-y-4">
              <button
                onClick={() => setShareMethod(null)}
                className="text-indigo-600 dark:text-indigo-400 hover:underline mb-4 flex items-center gap-2 text-sm sm:text-base"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>

              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 sm:p-6">
                <div className="text-center">
                  <div className="text-5xl sm:text-6xl mb-4">📁</div>
                  <h4 className="text-lg sm:text-xl font-semibold text-green-800 dark:text-green-200 mb-3">
                    Share as File
                  </h4>
                  <p className="text-sm sm:text-base text-green-700 dark:text-green-300 mb-6">
                    This will export your flashcard set as a file and open your device's share menu.
                    You can share via WhatsApp, Email, Bluetooth, or any other app!
                  </p>
                  
                  <div className="space-y-3">
                    <div className="text-left bg-white dark:bg-gray-800 rounded-lg p-4">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        How to receive:
                      </p>
                      <ol className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 space-y-1 ml-4 list-decimal">
                        <li>Save the file your friend sends you</li>
                        <li>Go to "Receive" in the app</li>
                        <li>Select "Import from File"</li>
                        <li>Done! The set will be added to your library</li>
                      </ol>
                    </div>

                    {!isFileShareSupported() && (
                      <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-3">
                        ⚠️ File sharing not supported on this device. The file will be downloaded instead.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={handleShareAsFile}
                disabled={loading}
                className="w-full px-4 py-2.5 sm:px-6 sm:py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors text-sm sm:text-base"
              >
                {loading ? "Preparing File..." : isFileShareSupported() ? "Share File" : "Download File"}
              </button>
            </div>
          )}

          {/* QR Code Display */}
          {shareMethod === 'qr' && qrCodeUrl && (
            <div className="space-y-4">
              <button
                onClick={() => {
                  setShareMethod(null);
                  setQrCodeUrl('');
                }}
                className="text-indigo-600 dark:text-indigo-400 hover:underline mb-4 flex items-center gap-2 text-sm sm:text-base"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>

              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4 sm:p-6">
                <div className="text-center">
                  <h4 className="text-lg sm:text-xl font-semibold text-purple-800 dark:text-purple-200 mb-3">
                    QR Code Generated
                  </h4>
                  <p className="text-sm text-purple-700 dark:text-purple-300 mb-4">
                    Have your friend scan this code with their camera to import the flashcard set
                  </p>
                  
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 inline-block mb-4">
                    <img 
                      src={qrCodeUrl} 
                      alt="QR Code" 
                      className="w-64 h-64 sm:w-80 sm:h-80 mx-auto"
                    />
                  </div>

                  <div className="text-left bg-white dark:bg-gray-800 rounded-lg p-4 mb-4">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      How to scan:
                    </p>
                    <ol className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 space-y-1 ml-4 list-decimal">
                      <li>Open the app on another device</li>
                      <li>Tap "Receive Shared Set" button</li>
                      <li>Select "Scan QR Code"</li>
                      <li>Point camera at this QR code</li>
                      <li>The flashcard set will be imported automatically!</li>
                    </ol>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={downloadQRCode}
                  className="flex-1 px-4 py-2 sm:px-6 sm:py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors text-sm sm:text-base"
                >
                  Download QR
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 sm:px-6 sm:py-3 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm sm:text-base"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Pairing Code Display */}
          {shareMethod === 'pairing' && pairingSession && (
            <div className="space-y-4">
              <button
                onClick={() => {
                  setShareMethod(null);
                  setPairingSession(null);
                }}
                className="text-indigo-600 dark:text-indigo-400 hover:underline mb-4 flex items-center gap-2 text-sm sm:text-base"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 sm:p-6">
                <div className="text-center">
                  <div className="text-6xl mb-4">🔗</div>
                  <h4 className="text-lg sm:text-xl font-semibold text-blue-800 dark:text-blue-200 mb-3">
                    Pairing Code Generated
                  </h4>
                  <p className="text-sm text-blue-700 dark:text-blue-300 mb-6">
                    Share this code with your friend. They'll enter it in the "Receive" section.
                  </p>
                  
                  {/* Large Pairing Code Display */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-6 mb-6">
                    <div className="text-5xl sm:text-6xl font-mono font-bold text-indigo-600 dark:text-indigo-400 tracking-widest">
                      {pairingSession.session_code}
                    </div>
                  </div>

                  <button
                    onClick={() => copyToClipboard(pairingSession.session_code)}
                    className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors mb-4"
                  >
                    📋 Copy Code
                  </button>

                  <div className="text-left bg-white dark:bg-gray-800 rounded-lg p-4 mb-4">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      How to receive:
                    </p>
                    <ol className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 space-y-1 ml-4 list-decimal">
                      <li>Open the app on another device</li>
                      <li>Tap "Receive Shared Set" button</li>
                      <li>Select "Enter Pairing Code"</li>
                      <li>Enter the 6-digit code: <strong className="font-mono">{pairingSession.session_code}</strong></li>
                      <li>The flashcard set will be transferred!</li>
                    </ol>
                  </div>

                  <div className="text-xs text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/30 rounded p-3">
                    ⏱️ This code expires in 10 minutes. Status: <strong>{pairingSession.status}</strong>
                  </div>
                </div>
              </div>

              <button
                onClick={onClose}
                className="w-full px-4 py-2 sm:px-6 sm:py-3 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm sm:text-base"
              >
                Done
              </button>
            </div>
          )}

          {/* Loading State for Pairing Code */}
          {shareMethod === 'pairing' && loading && !pairingSession && (
            <div className="text-center py-8">
              <div className="text-6xl mb-4 animate-pulse">🔗</div>
              <p className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Generating pairing code...
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Please wait a moment
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Custom Modal */}
      <CustomModal
        isOpen={modalState.isOpen}
        onClose={closeModal}
        title={modalState.title}
        message={modalState.message}
        type={modalState.type}
      />
    </>
  );
}