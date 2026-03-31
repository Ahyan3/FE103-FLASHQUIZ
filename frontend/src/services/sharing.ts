// src/services/sharing.ts
import { getAuthHeaders } from './auth';

// Use environment variable or fallback to network IP
const API_BASE = import.meta.env.VITE_API_URL || 'http://192.168.8.36:8000/api';

// ==================== INTERNET SHARING ====================

export interface ShareLinkOptions {
  flashcard_set_id: string;
  share_type?: 'public' | 'private';
  expires_in_hours?: number;
  max_uses?: number;
  password?: string;
  allow_download?: boolean;
  allow_copy?: boolean;
}

export interface ShareLink {
  id: string;
  flashcard_set: string;
  share_code: string;
  share_type: string;
  is_active: boolean;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  allow_download: boolean;
  allow_copy: boolean;
  created_at: string;
  last_accessed_at: string | null;
  share_url: string;
  is_valid: boolean;
}

export async function createShareLink(options: ShareLinkOptions): Promise<ShareLink> {
  const response = await fetch(`${API_BASE}/share/create/`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to create share link');
  }

  return response.json();
}

export async function getShareLinks(): Promise<ShareLink[]> {
  const response = await fetch(`${API_BASE}/share/links/`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch share links');
  }

  return response.json();
}

export async function deleteShareLink(shareCode: string): Promise<void> {
  const response = await fetch(`${API_BASE}/share/${shareCode}/delete/`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to delete share link');
  }
}

export async function accessSharedSet(shareCode: string, password?: string, action: 'view' | 'download' | 'copy' = 'view') {
  const response = await fetch(`${API_BASE}/share/access/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ share_code: shareCode, password, action }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to access shared set');
  }

  return response.json();
}

export async function copySharedSet(shareCode: string, password?: string) {
  const response = await fetch(`${API_BASE}/share/copy/`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ share_code: shareCode, password }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to copy shared set');
  }

  return response.json();
}

// ==================== BLUETOOTH SHARING ====================

export interface BluetoothShareOptions {
  flashcard_set_id: string;
  device_name?: string;
  device_id?: string;
}

export interface BluetoothShare {
  id: string;
  sender: number;
  sender_username: string;
  recipient: number | null;
  recipient_username: string | null;
  flashcard_set: string;
  flashcard_set_title: string;
  session_code: string;
  device_name: string | null;
  device_id: string | null;
  status: 'initiated' | 'paired' | 'transferring' | 'completed' | 'failed' | 'cancelled';
  progress_percentage: number;
  initiated_at: string;
  paired_at: string | null;
  completed_at: string | null;
  expires_at: string;
  is_valid: boolean;
}

export async function initiateBluetoothShare(options: BluetoothShareOptions): Promise<BluetoothShare> {
  const response = await fetch(`${API_BASE}/bluetooth/initiate/`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to initiate Bluetooth share');
  }

  return response.json();
}

export async function acceptBluetoothShare(sessionCode: string, deviceName?: string, deviceId?: string): Promise<BluetoothShare> {
  const response = await fetch(`${API_BASE}/bluetooth/accept/`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ session_code: sessionCode, device_name: deviceName, device_id: deviceId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to accept Bluetooth share');
  }

  return response.json();
}

export async function completeBluetoothShare(sessionCode: string) {
  const response = await fetch(`${API_BASE}/bluetooth/${sessionCode}/complete/`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to complete Bluetooth share');
  }

  return response.json();
}

export async function cancelBluetoothShare(sessionCode: string): Promise<void> {
  const response = await fetch(`${API_BASE}/bluetooth/${sessionCode}/cancel/`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to cancel Bluetooth share');
  }
}

export async function getBluetoothShareStatus(sessionCode: string): Promise<BluetoothShare> {
  const response = await fetch(`${API_BASE}/bluetooth/${sessionCode}/status/`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to get Bluetooth share status');
  }

  return response.json();
}

export async function getActiveBluetoothShares(): Promise<BluetoothShare[]> {
  const response = await fetch(`${API_BASE}/bluetooth/active/`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch active Bluetooth shares');
  }

  return response.json();
}