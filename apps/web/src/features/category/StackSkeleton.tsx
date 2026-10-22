import React from 'react';
import { COLOR_TOKENS, RADIUS_TOKENS } from '@kaaj/design';

export const StackSkeleton: React.FC = () => {
  const heights = [52, 68, 48, 80, 56, 44, 72];
  const widths = ['96%', '98%', '95%', '97%', '99%', '96%', '98%'];

  return (
    <ul
      data-testid="stack-skeleton"
      aria-label="Loading catalogue stack"
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        width: '100%',
      }}
    >
      <style>{`
        @keyframes skeletonPulse {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 0.8; }
        }
      `}</style>
      {heights.map((h, i) => (
        <li
          key={i}
          style={{
            width: widths[i],
            height: `${h}px`,
            backgroundColor: COLOR_TOKENS.paperDark,
            borderRadius: RADIUS_TOKENS.sm,
            animation: 'skeletonPulse 1.4s ease-in-out infinite',
            animationDelay: `${i * 120}ms`,
          }}
        />
      ))}
    </ul>
  );
};
