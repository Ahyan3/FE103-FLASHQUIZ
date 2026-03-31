// src/components/ReceiveModal.tsx
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useModal } from "../hooks/useModal";
import CustomModal from "./CustomModal";
import { importFromFile, startQRScanner, isCameraAvailable } from "../utils/offlineSharing";
import { acceptBluetoothShare, completeBluetoothShare } from "../services/sharing";

interface ReceiveModalProps {
  onClose: () => void;
}

export default function ReceiveModal({ onClose }: ReceiveModalProps) {
  const navigate = useNavigate();
  const { modalState, showAlert, closeModal } = useModal();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [receiveMethod, setReceiveMethod] = useState<'file' | 'qr' | 'internet' | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  
  // Internet (pairing code) states
  const [pairingCode, setPairingCode] = useState("");
  const [receivedSetId, setReceivedSetId] = useState<string | null>(null);
  const [status, setStatus] = useState<'input' | 'accepting' | 'completed'>('input');

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const newSet = await importFromFile(file);
      showAlert(`Successfully imported "${newSet.title}" with ${newSet.cards.length} cards!`, "Success", "success");
      navigate(`/set/${newSet.id}`);
      onClose();
    } catch (error) {
      console.error("Error importing file:", error);
      showAlert(`Failed to import file: ${error instanceof Error ? error.message : 'Unknown error'}`, "Error", "error");
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleQRScan = async () => {
    if (!isCameraAvailable()) {
      showAlert("Camera not available on this device", "Error", "error");
      return;
    }

    setScanning(true);
    setLoading(true);
    try {
      const newSet = await startQRScanner();
      showAlert(`Successfully scanned "${newSet.title}" with ${newSet.cards.length} cards!`, "Success", "success");
      navigate(`/set/${newSet.id}`);
      onClose();
    } catch (error) {
      console.error("Error scanning QR code:", error);
      showAlert(`Failed to scan QR code: ${error instanceof Error ? error.message : 'Unknown error'}`, "Error", "error");
    } finally {
      setScanning(false);
      setLoading(false);
    }
  };

  const handleAcceptPairingCode = async () => {
    if (!pairingCode.trim()) {
      showAlert("Please enter a pairing code", "Invalid Input", "error");
      return;
    }

    if (pairingCode.length !== 6) {
      showAlert("Pairing code must be 6 digits", "Invalid Input", "error");
      return;
    }

    setLoading(true);
    setStatus('accepting');

    try {
      const share = await acceptBluetoothShare(pairingCode.trim());
      const result = await completeBluetoothShare(share.session_code);
      
      setReceivedSetId(result.flashcard_set.id);
      setStatus('completed');
    } catch (error) {
      console.error("Error receiving share:", error);
      showAlert(`Failed to receive share: ${error instanceof Error ? error.message : 'Unknown error'}`, "Error", "error");
      setStatus('input');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full p-4 sm:p-6 max-h-[90vh] overflow-y-auto animate-slide-up">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <h3 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">
              Receive Flashcards
            </h3>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Method Selection */}
          {!receiveMethod && status === 'input' && (
            <div className="space-y-3">
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mb-4">
                Choose how you want to receive flashcards:
              </p>

              {/* File Import (offline) */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="w-full p-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-lg shadow-md hover:shadow-lg transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="text-3xl">📁</div>
                  <div className="flex-1">
                    <h4 className="text-base font-semibold mb-1">Import from File</h4>
                    <p className="text-xs text-green-100">
                      Upload a .flashquiz file (offline)
                    </p>
                  </div>
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* QR Scanner (offline) */}
              <button
                onClick={() => {
                  setReceiveMethod('qr');
                  handleQRScan();
                }}
                disabled={loading || scanning}
                className="w-full p-4 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-lg shadow-md hover:shadow-lg transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="text-3xl">📷</div>
                  <div className="flex-1">
                    <h4 className="text-base font-semibold mb-1">Scan QR Code</h4>
                    <p className="text-xs text-purple-100">
                      {scanning ? "Camera starting..." : "Use camera to scan (offline)"}
                    </p>
                  </div>
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* Pairing Code (requires server) */}
              <button
                onClick={() => setReceiveMethod('internet')}
                className="w-full p-4 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-lg shadow-md hover:shadow-lg transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="text-3xl">🔗</div>
                  <div className="flex-1">
                    <h4 className="text-base font-semibold mb-1">Enter Pairing Code</h4>
                    <p className="text-xs text-blue-100">
                      Use 6-digit code from sender (requires internet)
                    </p>
                  </div>
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".flashquiz,.json"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          )}

          {/* QR Scanning State */}
          {receiveMethod === 'qr' && scanning && (
            <div className="text-center py-8">
              <div className="text-6xl mb-4 animate-pulse">📷</div>
              <p className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Point camera at QR code
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                Position the QR code within the camera view
              </p>
              <button
                onClick={() => {
                  setReceiveMethod(null);
                  setScanning(false);
                }}
                className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Pairing Code Input */}
          {receiveMethod === 'internet' && status === 'input' && (
            <div className="space-y-4">
              <button
                onClick={() => setReceiveMethod(null)}
                className="text-indigo-600 dark:text-indigo-400 hover:underline mb-4 flex items-center gap-2 text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>

              <div className="text-center mb-6">
                <div className="text-5xl mb-4">🔗</div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Enter the 6-digit pairing code from the sender
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Pairing Code *
                </label>
                <input
                  type="text"
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-2xl text-center tracking-widest font-mono focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setReceiveMethod(null)}
                  className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAcceptPairingCode}
                  disabled={loading || pairingCode.length !== 6}
                  className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                >
                  {loading ? "Connecting..." : "Receive"}
                </button>
              </div>
            </div>
          )}

          {/* Receiving State */}
          {status === 'accepting' && (
            <div className="text-center py-8">
              <div className="text-6xl mb-4 animate-pulse">🔗</div>
              <p className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Receiving flashcard set...
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Please wait while we transfer the data
              </p>
              <div className="mt-6">
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div className="bg-indigo-600 h-2 rounded-full animate-pulse" style={{ width: '75%' }}></div>
                </div>
              </div>
            </div>
          )}

          {/* Completed State */}
          {status === 'completed' && receivedSetId && (
            <div className="text-center py-8">
              <div className="text-6xl mb-4">✅</div>
              <p className="text-lg font-medium text-green-600 dark:text-green-400 mb-2">
                Received successfully!
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                The flashcard set has been added to your library
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    navigate(`/set/${receivedSetId}`);
                    onClose();
                  }}
                  className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
                >
                  Open Set
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  Close
                </button>
              </div>
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