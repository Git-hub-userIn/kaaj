import React, { useState } from 'react';
import { COLOR_TOKENS, TYPOGRAPHY_TOKENS, SPACING_TOKENS, RADIUS_TOKENS, CURRENT_USER } from '@kaaj/design';
import { Search, Trash2 } from 'lucide-react';
import { GlobalBackupStatus } from '../backup/GlobalBackupStatus';
import { TrashModal } from '../trash/TrashModal.js';

export const HomeHeader: React.FC = () => {
  const [trashOpen, setTrashOpen] = useState(false);

  const triggerPalette = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  };

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `${SPACING_TOKENS.lg} ${SPACING_TOKENS.xl}`,
        maxWidth: '1440px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Kaaj Brand Lockup (Extracted Morpankh Logo + App Typography) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <img
          src="/favicon.svg"
          alt="Kaaj Logo"
          style={{
            width: '38px',
            height: '38px',
            display: 'block',
            userSelect: 'none',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACING_TOKENS.sm }}>
          <h1
            data-testid="kaaj-wordmark"
            style={{
              margin: 0,
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
              fontSize: '32px',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: COLOR_TOKENS.terracotta,
              lineHeight: 1,
            }}
          >
            Kaaj
          </h1>
          <span
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilyHandwriting,
              fontSize: '18px',
              color: COLOR_TOKENS.inkMuted,
              opacity: 0.85,
              userSelect: 'none',
            }}
          >
            काज
          </span>
        </div>
      </div>

      {/* Search Button + Global backup status + User avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          type="button"
          data-testid="open-command-palette-btn"
          onClick={triggerPalette}
          aria-label="Search entries (Cmd+K)"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            backgroundColor: COLOR_TOKENS.paperWarm,
            border: `1px solid ${COLOR_TOKENS.border}`,
            borderRadius: RADIUS_TOKENS.sm,
            color: COLOR_TOKENS.inkMuted,
            fontSize: '13px',
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
            cursor: 'pointer',
          }}
        >
          <Search size={14} aria-hidden="true" />
          <span>Search...</span>
          <kbd
            style={{
              fontSize: '10px',
              padding: '1px 5px',
              border: `1px solid ${COLOR_TOKENS.border}`,
              borderRadius: RADIUS_TOKENS.xs,
              backgroundColor: COLOR_TOKENS.paperSubtle,
            }}
          >
            ⌘K
          </kbd>
        </button>

        {/* Trash View Button */}
        <button
          type="button"
          data-testid="open-trash-btn"
          onClick={() => setTrashOpen(true)}
          aria-label="View Trash"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            backgroundColor: COLOR_TOKENS.paperWarm,
            border: `1px solid ${COLOR_TOKENS.border}`,
            borderRadius: RADIUS_TOKENS.sm,
            color: COLOR_TOKENS.inkMuted,
            fontSize: '13px',
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
            cursor: 'pointer',
          }}
        >
          <Trash2 size={14} aria-hidden="true" />
          <span>Trash</span>
        </button>

        <GlobalBackupStatus />

        <div
          data-testid="user-avatar"
          role="img"
          aria-label={`User profile: ${CURRENT_USER.name} (${CURRENT_USER.initials})`}
          tabIndex={0}
          style={{
            width: '38px',
            height: '38px',
            borderRadius: RADIUS_TOKENS.full,
            backgroundColor: COLOR_TOKENS.paperSubtle,
            border: `1.5px solid ${COLOR_TOKENS.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
            fontSize: '13px',
            fontWeight: 600,
            color: COLOR_TOKENS.ink,
            letterSpacing: '0.04em',
            boxShadow: '0 1px 3px rgba(45, 35, 25, 0.08)',
            cursor: 'default',
            userSelect: 'none',
          }}
        >
          {CURRENT_USER.initials}
        </div>
      </div>

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
      />
    </header>
  );
};
