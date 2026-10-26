import React from 'react';
import { COLOR_TOKENS, TYPOGRAPHY_TOKENS, SPACING_TOKENS, RADIUS_TOKENS, CURRENT_USER } from '@kaaj/design';
import { GlobalBackupStatus } from '../backup/GlobalBackupStatus';

export const HomeHeader: React.FC = () => {
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

      {/* Global backup status + User avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
    </header>
  );
};
