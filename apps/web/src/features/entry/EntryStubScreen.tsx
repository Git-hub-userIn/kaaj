import React, { useEffect, useState } from 'react';
import { HomeHeader } from '../home/HomeHeader.js';
import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
} from '@kaaj/design';
import type { Entry } from '@kaaj/doc-model';
import { RiArrowLeftLine } from '@remixicon/react';

interface EntryStubScreenProps {
  entryId: string;
  onNavigateBack: () => void;
}

export const EntryStubScreen: React.FC<EntryStubScreenProps> = ({
  entryId,
  onNavigateBack,
}) => {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`http://localhost:3001/entries/${entryId}`, {
      headers: { Authorization: 'Bearer kaaj-local-dev-token' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data) {
          setEntry(data);
        }
        if (active) setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [entryId]);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: COLOR_TOKENS.canvas,
        color: COLOR_TOKENS.ink,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <HomeHeader />

      <main
        style={{
          flex: 1,
          maxWidth: '720px',
          margin: '0 auto',
          padding: `${SPACING_TOKENS.xl} ${SPACING_TOKENS.lg}`,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <button
          type="button"
          data-testid="entry-back-btn"
          onClick={onNavigateBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: SPACING_TOKENS.xs,
            background: 'none',
            border: 'none',
            color: COLOR_TOKENS.inkMuted,
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
            fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
            cursor: 'pointer',
            padding: 0,
            marginBottom: SPACING_TOKENS.lg,
          }}
        >
          <RiArrowLeftLine size={16} />
          Back to Catalogue
        </button>

        <div
          data-testid="entry-stub-card"
          style={{
            backgroundColor: COLOR_TOKENS.paper,
            border: `1.5px solid ${COLOR_TOKENS.border}`,
            borderRadius: RADIUS_TOKENS.md,
            padding: SPACING_TOKENS.xxl,
            boxShadow: SHADOW_TOKENS.tile,
          }}
        >
          <h1
            data-testid="entry-title-heading"
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
              fontSize: TYPOGRAPHY_TOKENS.fontSize.heading1,
              margin: `0 0 ${SPACING_TOKENS.md} 0`,
              color: COLOR_TOKENS.ink,
            }}
          >
            {loading ? 'Loading...' : entry?.title || 'Entry'}
          </h1>

          <p
            style={{
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              fontSize: TYPOGRAPHY_TOKENS.fontSize.base,
              color: COLOR_TOKENS.inkMuted,
              lineHeight: 1.6,
            }}
          >
            Editor coming in Phase 3. The full fixed-ratio canvas with Tiptap rich text and SVG layers
            will open here.
          </p>

          <div
            style={{
              marginTop: SPACING_TOKENS.xl,
              paddingTop: SPACING_TOKENS.md,
              borderTop: `1px solid ${COLOR_TOKENS.borderSubtle}`,
              display: 'flex',
              gap: SPACING_TOKENS.lg,
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilyMono,
              fontSize: TYPOGRAPHY_TOKENS.fontSize.xs,
              color: COLOR_TOKENS.inkLight,
            }}
          >
            <span>ID: {entryId}</span>
            {entry?.weight !== undefined && <span>Weight: {entry.weight}</span>}
            {entry?.version !== undefined && <span>Version: {entry.version}</span>}
          </div>
        </div>
      </main>
    </div>
  );
};
