import React, { useState, useEffect, Suspense } from 'react';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/600.css';
import '@fontsource/newsreader/700.css';
import '@fontsource/kalam/400.css';
import '@fontsource/kalam/700.css';

import { HomeScreen } from './features/home/HomeScreen.js';
import { CategoryStubScreen } from './features/category/CategoryStubScreen.js';

// Code-split heavy editor so home screen stays under 150 KB gzipped
const LazySpikeEditor = React.lazy(() =>
  import('./features/editor/SpikeEditor.js').then((m) => ({ default: m.SpikeEditor }))
);

export const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState<string>(() => window.location.pathname);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (to: string) => {
    window.history.pushState({}, '', to);
    setCurrentPath(to);
  };

  // Route: /category/:id
  const categoryMatch = currentPath.match(/^\/category\/([^/]+)/);
  if (categoryMatch) {
    const categoryId = categoryMatch[1];
    return <CategoryStubScreen categoryId={categoryId} onNavigateHome={() => navigate('/')} />;
  }

  // Route: /spike or /editor
  if (currentPath === '/spike' || currentPath === '/editor') {
    return (
      <Suspense fallback={<div style={{ padding: '32px', textAlign: 'center' }}>Loading editor...</div>}>
        <LazySpikeEditor />
      </Suspense>
    );
  }

  // Default Route: / (Home Screen: Catalogues)
  return <HomeScreen onNavigateToCategory={(id) => navigate(`/category/${id}`)} />;
};
