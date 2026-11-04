import React, { useEffect, useState } from 'react';
import { COLOR_TOKENS, TYPOGRAPHY_TOKENS, RADIUS_TOKENS, SPACING_TOKENS } from '@kaaj/design';
import { Sparkles, Calendar, ChevronRight } from 'lucide-react';
import { API_BASE_URL, getAuthHeaders , apiFetch } from '../../config/api.js';

interface OnThisDayEntry {
  id: string;
  title: string;
  categoryId: string;
  createdAt: string;
}

export const OnThisDayWidget: React.FC = () => {
  const [entries, setEntries] = useState<OnThisDayEntry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    apiFetch(`${API_BASE_URL}/entries/on-this-day`, { headers: getAuthHeaders() })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        setEntries(Array.isArray(data) ? data : []);
        setIsLoaded(true);
      })
      .catch(() => setIsLoaded(true));
  }, []);

  const navigateToEntry = (id: string) => {
    window.history.pushState({}, '', `/entry/${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  if (!isLoaded) return null;

  return (
    <section
      data-testid="on-this-day-widget"
      aria-label="On this day memory recall"
      style={{
        backgroundColor: COLOR_TOKENS.paperWarm,
        border: `1px solid ${COLOR_TOKENS.border}`,
        borderRadius: RADIUS_TOKENS.md,
        padding: `${SPACING_TOKENS.md} ${SPACING_TOKENS.lg}`,
        marginBottom: SPACING_TOKENS.lg,
        fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: entries.length > 0 ? '10px' : 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={16} color={COLOR_TOKENS.terracotta} aria-hidden="true" />
          <h2
            style={{
              margin: 0,
              fontSize: '14px',
              fontWeight: 600,
              color: COLOR_TOKENS.ink,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            On This Day
          </h2>
        </div>
        <span
          data-testid="on-this-day-badge"
          style={{
            fontSize: '12px',
            color: COLOR_TOKENS.inkMuted,
            backgroundColor: COLOR_TOKENS.paperSubtle,
            padding: '2px 8px',
            borderRadius: RADIUS_TOKENS.full,
          }}
        >
          {entries.length === 1 ? '1 memory' : `${entries.length} memories`}
        </span>
      </div>

      {entries.length === 0 ? (
        <div
          data-testid="on-this-day-empty"
          style={{ fontSize: '13px', color: COLOR_TOKENS.inkMuted, fontStyle: 'italic', marginTop: '4px' }}
        >
          No memories recorded on this day in past years.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {entries.map((entry) => {
            const year = new Date(entry.createdAt).getFullYear();
            return (
              <button
                key={entry.id}
                type="button"
                data-testid="on-this-day-item"
                data-entry-id={entry.id}
                onClick={() => navigateToEntry(entry.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  backgroundColor: COLOR_TOKENS.paper,
                  border: `1px solid ${COLOR_TOKENS.border}`,
                  borderRadius: RADIUS_TOKENS.sm,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background-color 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Calendar size={13} color={COLOR_TOKENS.inkMuted} aria-hidden="true" />
                  <span style={{ fontSize: '13px', fontWeight: 500, color: COLOR_TOKENS.ink }}>
                    {entry.title || 'Untitled'}
                  </span>
                  <span style={{ fontSize: '11px', color: COLOR_TOKENS.inkMuted }}>({year})</span>
                </div>
                <ChevronRight size={14} color={COLOR_TOKENS.inkMuted} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
