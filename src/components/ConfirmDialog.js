import React, { useEffect, useRef } from 'react';

/**
 * Blocking confirm dialog for destructive actions.
 *
 * Rendered inline rather than via window.confirm so the tournament name and what is
 * about to be lost can be shown, and so the confirm button can carry danger styling.
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    // Focus the safe action, not the destructive one.
    cancelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel?.();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-gray-200 overflow-hidden">
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className="shrink-0 h-10 w-10 rounded-full bg-red-100 flex items-center justify-center text-xl">
              ⚠️
            </div>
            <div className="min-w-0">
              <h3 id="confirm-dialog-title" className="text-lg font-bold text-gray-900">
                {title}
              </h3>
              <div className="text-sm text-gray-600 mt-2 space-y-2">{children}</div>
            </div>
          </div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 py-4 bg-gray-50 border-t border-gray-200">
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="min-h-[44px] px-4 rounded-lg border border-gray-300 bg-white font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="min-h-[44px] px-4 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
