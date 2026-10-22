import React, { useEffect, useRef, useState } from 'react';
import { CANVAS_TOKENS, COLOR_TOKENS, RADIUS_TOKENS } from '@kaaj/design';

interface CanvasContainerProps {
  children: React.ReactNode;
}

export const CanvasContainer: React.FC<CanvasContainerProps> = ({ children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      const horizontalPadding = 48;
      const verticalPadding = 48;

      const availWidth = Math.max(300, clientWidth - horizontalPadding);
      const availHeight = Math.max(400, clientHeight - verticalPadding);

      const scaleX = availWidth / CANVAS_TOKENS.logicalWidth;
      const scaleY = availHeight / CANVAS_TOKENS.logicalHeight;

      // Fit inside viewport while keeping 3:4 aspect ratio
      const nextScale = Math.min(scaleX, scaleY, 1.2);
      setScale(Math.max(0.2, nextScale));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    window.addEventListener('resize', updateScale);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: 'calc(100vh - 80px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'auto',
        backgroundColor: COLOR_TOKENS.canvas,
        padding: '24px',
      }}
    >
      <div
        id="canvas-scaled-viewport"
        style={{
          width: `${CANVAS_TOKENS.logicalWidth * scale}px`,
          height: `${CANVAS_TOKENS.logicalHeight * scale}px`,
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <div
          id="canvas-logical-page"
          data-testid="canvas-page"
          style={{
            width: `${CANVAS_TOKENS.logicalWidth}px`,
            height: `${CANVAS_TOKENS.logicalHeight}px`,
            position: 'absolute',
            top: 0,
            left: 0,
            transformOrigin: 'top left',
            transform: `scale(${scale})`,
            backgroundColor: COLOR_TOKENS.paper,
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)',
            borderRadius: RADIUS_TOKENS.sm,
            overflow: 'hidden',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
