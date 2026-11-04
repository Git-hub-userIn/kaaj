import React, { useEffect } from 'react';
import { COLOR_TOKENS, TYPOGRAPHY_TOKENS, RADIUS_TOKENS, COPY } from '@kaaj/design';
import { useAuth } from './AuthContext.js';

// Render the login screen for unauthenticated users.
export const LoginPage: React.FC = () => {
  const { user, loading } = useAuth();

  // Redirect to the home screen if the user already has an active session.
  useEffect(() => {
    if (!loading && user) {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [user, loading]);

  if (loading || user) {
    return null;
  }

  return (
    <main
      data-testid="login-screen"
      style={{
        minHeight: '100vh',
        width: '100%',
        backgroundColor: COLOR_TOKENS.canvas,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          backgroundColor: COLOR_TOKENS.paper,
          borderRadius: RADIUS_TOKENS.lg,
          border: `1px solid ${COLOR_TOKENS.border}`,
          boxShadow: '0 8px 30px rgba(45, 35, 25, 0.08)',
          padding: '48px 36px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      >
        {/* Kaaj Brand Lockup */}
        <img
          src="/favicon.svg"
          alt="Kaaj Logo"
          style={{
            width: '54px',
            height: '54px',
            marginBottom: '16px',
            display: 'block',
            userSelect: 'none',
          }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'center',
            gap: '8px',
            marginBottom: '8px',
          }}
        >
          <h1
            style={{
              margin: 0,
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
              fontSize: '36px',
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
              fontSize: '22px',
              color: COLOR_TOKENS.inkMuted,
              userSelect: 'none',
            }}
          >
            काज
          </span>
        </div>

        <p
          style={{
            margin: '0 0 36px 0',
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
            fontSize: '14px',
            lineHeight: 1.5,
            color: COLOR_TOKENS.inkMuted,
            maxWidth: '300px',
          }}
        >
          {COPY.cataloguesSubtitle}
        </p>

        {/* Exactly one action: Google OAuth navigation link */}
        <a
          href="/auth/google"
          data-testid="google-signin-btn"
          aria-label="Sign in with Google"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            width: '100%',
            padding: '12px 20px',
            backgroundColor: COLOR_TOKENS.paperWarm,
            border: `1px solid ${COLOR_TOKENS.border}`,
            borderRadius: RADIUS_TOKENS.md,
            color: COLOR_TOKENS.ink,
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
            fontSize: '15px',
            fontWeight: 600,
            textDecoration: 'none',
            boxShadow: '0 1px 3px rgba(45, 35, 25, 0.05)',
            boxSizing: 'border-box',
            transition: 'background-color 150ms ease, box-shadow 150ms ease, transform 100ms ease',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = COLOR_TOKENS.paperSubtle;
            e.currentTarget.style.boxShadow = '0 2px 6px rgba(45, 35, 25, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = COLOR_TOKENS.paperWarm;
            e.currentTarget.style.boxShadow = '0 1px 3px rgba(45, 35, 25, 0.05)';
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.97 0 12s.45 3.84 1.25 5.42l4.03-3.15z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
            />
          </svg>
          <span>Sign in with Google</span>
        </a>
      </div>
    </main>
  );
};
