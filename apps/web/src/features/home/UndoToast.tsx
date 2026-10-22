import React, { useEffect } from 'react';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  COPY,
} from '@kaaj/design';

interface UndoToastProps {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number;
}

export const UndoToast: React.FC<UndoToastProps> = ({
  message,
  onUndo,
  onDismiss,
  durationMs = 6000,
}) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, durationMs);

    return () => clearTimeout(timer);
  }, [durationMs, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-toast"
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: COLOR_TOKENS.paper,
        border: `1.5px solid ${COLOR_TOKENS.border}`,
        borderRadius: RADIUS_TOKENS.md,
        padding: `${SPACING_TOKENS.sm} ${SPACING_TOKENS.lg}`,
        boxShadow: SHADOW_TOKENS.toast,
        display: 'flex',
        alignItems: 'center',
        gap: SPACING_TOKENS.md,
        zIndex: 100,
        animation: 'toastEntrance 250ms ease-out both',
      }}
    >
      <style>{`
        @keyframes toastEntrance {
          from {
            opacity: 0;
            transform: translate(-50%, 16px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
      `}</style>
      <span
        style={{
          fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
          fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
          color: COLOR_TOKENS.ink,
        }}
      >
        {message}
      </span>
      <button
        type="button"
        data-testid="undo-delete-btn"
        onClick={onUndo}
        style={{
          backgroundColor: COLOR_TOKENS.terracottaLight,
          color: COLOR_TOKENS.terracotta,
          border: 'none',
          padding: `${SPACING_TOKENS.xs} ${SPACING_TOKENS.sm}`,
          borderRadius: RADIUS_TOKENS.xs,
          fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
          fontSize: TYPOGRAPHY_TOKENS.fontSize.xs,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {COPY.undoDelete}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notice"
        style={{
          background: 'none',
          border: 'none',
          color: COLOR_TOKENS.inkMuted,
          fontSize: '14px',
          cursor: 'pointer',
          padding: '2px',
        }}
      >
        ✕
      </button>
    </div>
  );
};
