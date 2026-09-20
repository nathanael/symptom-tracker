import { useEffect } from 'react';

// Bottom toast for bulk actions: acts immediately, offers Undo for a few seconds
export default function UndoToast({ toast, onDismiss, isDesktop }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div className={`lr-toast ${isDesktop ? '' : 'lr-toast-mobile'}`} role="status">
      <span>{toast.message}</span>
      {toast.onUndo && (
        <button
          className="lr-toast-undo"
          onClick={() => {
            toast.onUndo();
            onDismiss();
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}
