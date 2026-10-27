import React, { useState, useEffect, Suspense } from 'react';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/600.css';
import '@fontsource/newsreader/700.css';
import '@fontsource/kalam/400.css';
import '@fontsource/kalam/700.css';
import '@fontsource/special-elite/400.css';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/600.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';

import { HomeScreen } from './features/home/HomeScreen.js';
import { CategoryStackScreen } from './features/category/CategoryStackScreen.js';

// Code-split entry editor so home and catalogue stack screens stay light
const LazyEntryEditor = React.lazy(() =>
  import('./features/editor/EntryEditorScreen.js').then((m) => ({ default: m.EntryEditorScreen }))
);

export const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState<string>(() => window.location.pathname);
  const isTestMode = (import.meta.env as any).APP_MODE === 'test';

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (to: string) => {
    window.history.pushState({}, '', to);
    setCurrentPath(to.split('?')[0]);
  };

  const renderContent = () => {
    // Route: /category/:id
    const categoryMatch = currentPath.match(/^\/category\/([^/]+)/);
    if (categoryMatch) {
      const categoryId = categoryMatch[1];
      return (
        <CategoryStackScreen
          categoryId={categoryId}
          onNavigateHome={() => navigate('/')}
          onNavigateToEntry={(entryId) => navigate(`/entry/${entryId}`)}
        />
      );
    }

    // Route: /entry/:id
    const entryMatch = currentPath.match(/^\/entry\/([^/]+)/);
    if (entryMatch) {
      const entryId = entryMatch[1];
      return (
        <Suspense fallback={<div style={{ padding: '32px', textAlign: 'center', fontFamily: 'serif' }}>Loading entry...</div>}>
          <LazyEntryEditor
            entryId={entryId}
            onNavigateBack={() => window.history.back()}
            onNavigateToCategory={(catId) => navigate(`/category/${catId}`)}
          />
        </Suspense>
      );
    }

    // Default Route: / (Home Screen: Catalogues)
    return <HomeScreen onNavigateToCategory={(id) => navigate(`/category/${id}`)} />;
  };

  return (
    <>
      {isTestMode && (
        <div
          data-testid="test-badge"
          style={{
            position: 'fixed',
            top: 12,
            right: 12,
            zIndex: 99999,
            backgroundColor: '#b91c1c',
            color: '#ffffff',
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            pointerEvents: 'none',
            border: '1px solid rgba(255,255,255,0.3)',
          }}
        >
          TEST
        </div>
      )}
      {renderContent()}
    </>
  );
};
