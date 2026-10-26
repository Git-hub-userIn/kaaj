import React, { useState, useRef, useEffect, useCallback } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { API_BASE_URL } from '../../../config/api.js';
import { Trash2, MessageSquare, Maximize2 } from 'lucide-react';

export const ImageBlockView: React.FC<NodeViewProps> = ({
  node,
  updateAttributes,
  deleteNode,
  selected,
}) => {
  const { assetId, alt = '', width = 1.0 } = node.attrs;
  const [isEditingAlt, setIsEditingAlt] = useState(false);
  const [altText, setAltText] = useState(alt || '');
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(1.0);

  // Synchronize local altText state when node attribute changes
  useEffect(() => {
    setAltText(alt || '');
  }, [alt]);

  const widthFraction = typeof width === 'number' && width > 0 && width <= 1.0 ? width : 1.0;
  const widthPercent = Math.round(widthFraction * 100);

  const setPresetWidth = (fraction: number) => {
    updateAttributes({ width: fraction });
  };

  const handleAltChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAltText(e.target.value);
  };

  const handleAltBlur = () => {
    updateAttributes({ alt: altText });
    setIsEditingAlt(false);
  };

  const handleAltKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      updateAttributes({ alt: altText });
      setIsEditingAlt(false);
    } else if (e.key === 'Escape') {
      setAltText(alt || '');
      setIsEditingAlt(false);
    }
  };

  // Keyboard navigation & deletion support
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      deleteNode();
    }
  };

  // Mouse drag-to-resize handle
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = widthFraction;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current?.parentElement) return;
      const parentWidth = containerRef.current.parentElement.getBoundingClientRect().width;
      if (parentWidth <= 0) return;

      const deltaX = moveEvent.clientX - startXRef.current;
      const deltaFraction = deltaX / parentWidth;
      const newFraction = Math.min(1.0, Math.max(0.2, startWidthRef.current + deltaFraction));
      updateAttributes({ width: parseFloat(newFraction.toFixed(2)) });
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [widthFraction, updateAttributes]);

  return (
    <NodeViewWrapper
      className={`kaaj-image-block-wrapper my-4 flex flex-col items-center select-none ${selected ? 'ProseMirror-selectednode' : ''}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={containerRef}
        data-testid="editor-image"
        data-asset-id={assetId}
        data-width={widthPercent}
        className="relative group transition-all duration-150 rounded"
        style={{
          width: `${widthPercent}%`,
          maxWidth: '100%',
        }}
      >
        {/* Main image element */}
        <img
          src={`${API_BASE_URL}/assets/${assetId}`}
          alt={alt || ''}
          data-asset-id={assetId}
          data-width={widthPercent}
          loading="lazy"
          className={`w-full h-auto block rounded shadow-sm object-cover transition-shadow duration-150 ${
            selected ? 'ring-2 ring-[#8b3a2b] shadow-md' : 'hover:shadow'
          }`}
          style={{ width: '100%', height: 'auto' }}
        />

        {/* Caption / Alt text indicator */}
        {alt && !selected && (
          <figcaption className="text-xs text-[#73685e] italic text-center mt-1">
            {alt}
          </figcaption>
        )}

        {/* Selected controls bar */}
        {selected && (
          <div
            data-testid="image-controls-toolbar"
            className="absolute -top-10 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-[#231e1a] text-[#f7f4ee] px-2 py-1 rounded-md shadow-lg text-xs z-20 whitespace-nowrap"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Width preset buttons */}
            <div className="flex items-center gap-1 border-r border-[#413932] pr-1.5 mr-0.5">
              <button
                type="button"
                data-testid="image-resize-25"
                onClick={() => setPresetWidth(0.25)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  widthPercent <= 30 ? 'bg-[#8b3a2b] text-white' : 'hover:bg-[#3d342d] text-[#b4a99d]'
                }`}
              >
                25%
              </button>
              <button
                type="button"
                data-testid="image-resize-50"
                onClick={() => setPresetWidth(0.5)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  widthPercent > 30 && widthPercent <= 60 ? 'bg-[#8b3a2b] text-white' : 'hover:bg-[#3d342d] text-[#b4a99d]'
                }`}
              >
                50%
              </button>
              <button
                type="button"
                data-testid="image-resize-75"
                onClick={() => setPresetWidth(0.75)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  widthPercent > 60 && widthPercent <= 85 ? 'bg-[#8b3a2b] text-white' : 'hover:bg-[#3d342d] text-[#b4a99d]'
                }`}
              >
                75%
              </button>
              <button
                type="button"
                data-testid="image-resize-100"
                onClick={() => setPresetWidth(1.0)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  widthPercent > 85 ? 'bg-[#8b3a2b] text-white' : 'hover:bg-[#3d342d] text-[#b4a99d]'
                }`}
              >
                100%
              </button>
            </div>

            {/* Alt text edit toggle */}
            <button
              type="button"
              data-testid="image-alt-toggle"
              onClick={() => setIsEditingAlt(!isEditingAlt)}
              title="Edit alt text"
              className={`p-1 rounded hover:bg-[#3d342d] transition-colors ${
                alt ? 'text-[#e5dfd5]' : 'text-[#8a7f74]'
              }`}
            >
              <MessageSquare size={13} />
            </button>

            {/* Delete button */}
            <button
              type="button"
              data-testid="image-delete-btn"
              onClick={deleteNode}
              title="Delete image"
              className="p-1 rounded hover:bg-[#8b3a2b] text-[#e5dfd5] transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}

        {/* Alt text inline input popover when toggled */}
        {selected && isEditingAlt && (
          <div
            className="absolute top-2 left-1/2 -translate-x-1/2 w-72 bg-[#fcfbf7] border border-[#d6cfc7] rounded shadow-md p-2 z-20"
            onClick={(e) => e.stopPropagation()}
          >
            <label className="block text-[11px] font-medium text-[#4a423a] mb-1">
              Description / Alt text:
            </label>
            <input
              type="text"
              data-testid="image-alt-input"
              value={altText}
              onChange={handleAltChange}
              onBlur={handleAltBlur}
              onKeyDown={handleAltKeyDown}
              placeholder="Describe this image for accessibility..."
              autoFocus
              className="w-full text-xs px-2 py-1 bg-white border border-[#c4bcb1] rounded focus:outline-none focus:border-[#8b3a2b]"
            />
          </div>
        )}

        {/* Bottom-right interactive corner resize handle */}
        {selected && (
          <div
            data-testid="image-resize-handle"
            onMouseDown={handleResizeStart}
            title="Drag to resize width"
            className="absolute -bottom-2 -right-2 w-5 h-5 bg-[#8b3a2b] text-white rounded-full flex items-center justify-center cursor-nwse-resize shadow-md hover:scale-110 active:scale-95 transition-transform z-10"
          >
            <Maximize2 size={10} className="rotate-90 pointer-events-none" />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
};
