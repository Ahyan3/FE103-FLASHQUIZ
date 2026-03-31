// src/hooks/useModal.ts
import { useState, useCallback } from 'react';

interface ModalState {
  isOpen: boolean;
  title?: string;
  message: string;
  type: 'alert' | 'confirm' | 'success' | 'error';
  onConfirm?: () => void;
}

export function useModal() {
  const [modalState, setModalState] = useState<ModalState>({
    isOpen: false,
    message: '',
    type: 'alert',
  });

  const showAlert = useCallback((message: string, title?: string, type: 'alert' | 'success' | 'error' = 'alert') => {
    setModalState({
      isOpen: true,
      message,
      title,
      type,
    });
  }, []);

  const showConfirm = useCallback((message: string, onConfirm: () => void, title?: string) => {
    setModalState({
      isOpen: true,
      message,
      title,
      type: 'confirm',
      onConfirm,
    });
  }, []);

  const closeModal = useCallback(() => {
    setModalState(prev => ({
      ...prev,
      isOpen: false,
    }));
  }, []);

  return {
    modalState,
    showAlert,
    showConfirm,
    closeModal,
  };
}