/* eslint-disable @typescript-eslint/no-explicit-any */
// src/utils/offlineSharing.ts
import type { FlashcardSet } from "../types/flashcard";
import { saveSet } from "./db";

// Generate UUID for new sets
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ==================== FILE SHARING (OFFLINE) ====================

export async function shareAsFile(flashcardSet: FlashcardSet): Promise<void> {
  // Get current user info for metadata
  const userStr = localStorage.getItem('user');
  const user = userStr ? JSON.parse(userStr) : null;
  
  // Prepare data for export
  const exportData = {
    version: '1.0',
    exported_at: new Date().toISOString(),
    original_creator: user?.username || 'Unknown',
    flashcard_set: {
      title: flashcardSet.title,
      category: flashcardSet.category,
      cards: flashcardSet.cards.map(card => ({
        question: card.question,
        answer: card.answer,
        position: card.position
      }))
    }
  };

  const jsonString = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const file = new File([blob], `${flashcardSet.title}.flashquiz`, { 
    type: 'application/json',
    lastModified: Date.now()
  });

  // Check if Web Share API with files is supported
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: flashcardSet.title,
        text: `FlashQuiz: ${flashcardSet.title}`,
        files: [file]
      });
      console.log('File shared successfully!');
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // User cancelled, that's okay
        return;
      }
      throw error;
    }
  } else {
    // Fallback: download the file
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${flashcardSet.title}.flashquiz`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('File downloaded (Web Share not supported)');
  }
}

export async function importFromFile(file: File): Promise<FlashcardSet> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);
        
        // Validate format
        if (!data.flashcard_set || !data.flashcard_set.title) {
          throw new Error('Invalid flashcard file format');
        }
        
        // Create new flashcard set with source tracking
        const newSet: FlashcardSet = {
          id: generateUUID(),
          title: data.flashcard_set.title,
          category: data.flashcard_set.category || 'Uncategorized',
          cards: (data.flashcard_set.cards || []).map((card: any, index: number) => ({
            id: generateUUID(),
            question: card.question || '',
            answer: card.answer || '',
            position: index,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_deleted: false
          })),
          createdAt: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          source: 'imported', // Mark as imported
          original_creator: data.original_creator || 'Unknown' // Track original creator
        };
        
        // Save to IndexedDB
        await saveSet(newSet);
        
        resolve(newSet);
      } catch (error) {
        reject(new Error(`Failed to import file: ${(error as Error).message}`));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsText(file);
  });
}

// ==================== QR CODE SHARING (OFFLINE) ====================

export async function generateQRCode(flashcardSet: FlashcardSet): Promise<string> {
  // Dynamically import qrcode only when needed
  const QRCode = await import('qrcode');
  
  // Get current user info for metadata
  const userStr = localStorage.getItem('user');
  const user = userStr ? JSON.parse(userStr) : null;
  
  // Limit data size for QR code
  const maxCards = 10;
  const cards = flashcardSet.cards.slice(0, maxCards);
  
  if (flashcardSet.cards.length > maxCards) {
    throw new Error(`QR codes work best with ${maxCards} or fewer cards. This set has ${flashcardSet.cards.length} cards. Please use File Share instead.`);
  }
  
  // Compress data for QR code
  const qrData = {
    v: '1',
    t: flashcardSet.title,
    c: flashcardSet.category,
    u: user?.username || 'Unknown', // Original creator username
    d: cards.map(card => ({
      q: card.question,
      a: card.answer
    }))
  };
  
  const jsonString = JSON.stringify(qrData);
  
  // Check data size
  if (jsonString.length > 2000) {
    throw new Error('This flashcard set is too large for a QR code. Please use File Share instead.');
  }
  
  // Generate QR code as data URL
  try {
    const qrCodeUrl = await QRCode.toDataURL(jsonString, {
      errorCorrectionLevel: 'L',
      width: 400,
      margin: 2,
      color: {
        dark: '#4f46e5',
        light: '#ffffff'
      }
    });
    
    return qrCodeUrl;
  } catch (error) {
    throw new Error(`Failed to generate QR code: ${(error as Error).message}`);
  }
}

export async function scanQRCode(qrImageData: string): Promise<FlashcardSet> {
  // Dynamically import jsqr only when needed
  const jsQR = (await import('jsqr')).default;
  
  // Create image element
  const img = new Image();
  img.src = qrImageData;
  
  return new Promise((resolve, reject) => {
    img.onload = () => {
      // Create canvas and draw image
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Decode QR code
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      
      if (!code) {
        reject(new Error('No QR code found in image'));
        return;
      }
      
      try {
        const data = JSON.parse(code.data);
        
        // Validate format
        if (!data.t || !data.d) {
          throw new Error('Invalid QR code format');
        }
        
        // Create flashcard set with source tracking
        const newSet: FlashcardSet = {
          id: generateUUID(),
          title: data.t,
          category: data.c || 'Uncategorized',
          cards: (data.d || []).map((card: any, index: number) => ({
            id: generateUUID(),
            question: card.q || '',
            answer: card.a || '',
            position: index,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_deleted: false
          })),
          createdAt: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          source: 'qr_scanned', // Mark as QR scanned
          original_creator: data.u || 'Unknown' // Track original creator
        };
        
        // Save to IndexedDB
        saveSet(newSet).then(() => {
          resolve(newSet);
        }).catch(reject);
      } catch (error) {
        reject(new Error(`Failed to decode QR code: ${(error as Error).message}`));
      }
    };
    
    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };
  });
}

// ==================== CAMERA QR SCANNER ====================

export async function startQRScanner(): Promise<FlashcardSet> {
  const jsQR = (await import('jsqr')).default;
  
  // Request camera permission
  const stream = await navigator.mediaDevices.getUserMedia({ 
    video: { facingMode: 'environment' } 
  });

  // Create video element
  const video = document.createElement('video');
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play();

  // Create canvas for processing
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  return new Promise((resolve, reject) => {
    let scanning = true;

    const checkForQR = () => {
      if (!scanning) return;

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, canvas.width, canvas.height);

        if (code) {
          // Found QR code!
          scanning = false;
          stream.getTracks().forEach(track => track.stop());
          
          try {
            const data = JSON.parse(code.data);
            
            const newSet: FlashcardSet = {
              id: generateUUID(),
              title: data.t,
              category: data.c || 'Uncategorized',
              cards: (data.d || []).map((card: any, index: number) => ({
                id: generateUUID(),
                question: card.q || '',
                answer: card.a || '',
                position: index,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                is_deleted: false
              })),
              createdAt: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              is_deleted: false,
              source: 'qr_scanned', // Mark as QR scanned
              original_creator: data.u || 'Unknown' // Track original creator
            };
            
            saveSet(newSet).then(() => {
              resolve(newSet);
            }).catch(reject);
          } catch (error) {
            reject(new Error(`Invalid QR code: ${(error as Error).message}`));
          }
          return;
        }
      }

      // Keep scanning
      requestAnimationFrame(checkForQR);
    };

    checkForQR();

    // Timeout after 60 seconds
    setTimeout(() => {
      if (scanning) {
        scanning = false;
        stream.getTracks().forEach(track => track.stop());
        reject(new Error('QR scan timeout'));
      }
    }, 60000);
  });
}

// ==================== HELPER FUNCTIONS ====================

export function isWebShareSupported(): boolean {
  return 'share' in navigator;
}

export function isFileShareSupported(): boolean {
  return 'canShare' in navigator && navigator.canShare({ files: [new File([], 'test')] });
}

export function isCameraAvailable(): boolean {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}