import React, { useState, useEffect, useMemo } from 'react';
import { COLOR_TOKENS, TYPOGRAPHY_TOKENS, SPACING_TOKENS, RADIUS_TOKENS, CURRENT_USER } from '@kaaj/design';
import { Search, Trash2, Sun, Moon, BookOpen, LogOut } from 'lucide-react';
import { GlobalBackupStatus } from '../backup/GlobalBackupStatus';
import { TrashModal } from '../trash/TrashModal.js';
import { API_BASE_URL, getAuthHeaders , apiFetch } from '../../config/api.js';
import { useAuth } from '../auth/AuthContext.js';

export const HomeHeader: React.FC = () => {
  const { user, logout } = useAuth();
  const [trashOpen, setTrashOpen] = useState(false);
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      document.documentElement.classList.contains('dark') ||
      localStorage.getItem('kaaj_theme') === 'dark'
    );
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('kaaj_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('kaaj_theme', 'light');
    }
  }, [isDark]);

  const triggerPalette = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  };

  const handleDailyJournal = async () => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/entries/daily-template`, {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        window.history.pushState({}, '', `/entry/${data.id}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    } catch (err) {
      console.error('Failed to create daily journal:', err);
    }
  };

  const userInitials = useMemo(() => {
    if (user?.name) {
      const parts = user.name.trim().split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
      }
      if (parts.length === 1 && parts[0].length > 0) {
        return parts[0].slice(0, 2).toUpperCase();
      }
    }
    if (user?.email) {
      return user.email.slice(0, 2).toUpperCase();
    }
    return CURRENT_USER.initials;
  }, [user]);

  const userName = user?.name || user?.email || CURRENT_USER.name;

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

        {/* Daily Journal Button */}
        <button
          type="button"
          data-testid="daily-journal-btn"
          onClick={handleDailyJournal}
          aria-label="New Daily Journal Entry"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            backgroundColor: COLOR_TOKENS.paperWarm,
            border: `1px solid ${COLOR_TOKENS.border}`,
            borderRadius: RADIUS_TOKENS.sm,
            color: COLOR_TOKENS.ink,
            fontSize: '13px',
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          <BookOpen size={14} aria-hidden="true" color={COLOR_TOKENS.terracotta} />
          <span>Journal</span>
        </button>

        {/* Theme Toggle Button */}
        <button
          type="button"
          data-testid="theme-toggle-btn"
          onClick={() => setIsDark((prev) => !prev)}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '6px',
            backgroundColor: COLOR_TOKENS.paperWarm,
            border: `1px solid ${COLOR_TOKENS.border}`,
            borderRadius: RADIUS_TOKENS.sm,
            color: COLOR_TOKENS.inkMuted,
            cursor: 'pointer',
          }}
        >
          {isDark ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
        </button>

        <GlobalBackupStatus />

        <div
          data-testid="user-avatar"
          role="img"
          aria-label={`User profile: ${userName} (${userInitials})`}
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
            overflow: 'hidden',
          }}
        >
          {user?.picture ? (
            <img
              src={user.picture}
              alt={userName}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                borderRadius: RADIUS_TOKENS.full,
              }}
            />
          ) : (
            <span>{userInitials}</span>
          )}
        </div>

        {/* Sign Out Button */}
        <button
          type="button"
          data-testid="sign-out-btn"
          onClick={logout}
          aria-label="Sign out"
          title="Sign out"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '6px',
            backgroundColor: COLOR_TOKENS.paperWarm,
            border: `1px solid ${COLOR_TOKENS.border}`,
            borderRadius: RADIUS_TOKENS.sm,
            color: COLOR_TOKENS.inkMuted,
            cursor: 'pointer',
          }}
        >
          <LogOut size={15} aria-hidden="true" />
        </button>
      </div>

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
      />
    </header>
  );
};
