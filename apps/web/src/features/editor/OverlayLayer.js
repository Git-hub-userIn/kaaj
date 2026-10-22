import { jsx as _jsx } from "react/jsx-runtime";
import { memo, useRef } from 'react';
import { COLOR_TOKENS, RADIUS_TOKENS } from '@kaaj/design';
const DraggableItem = memo(({ obj, isSelected, onSelect, onCommit, scale }) => {
    const elRef = useRef(null);
    const dragStartRef = useRef(null);
    const handlePointerDown = (e) => {
        e.stopPropagation();
        onSelect();
        if (!elRef.current)
            return;
        elRef.current.setPointerCapture(e.pointerId);
        elRef.current.style.willChange = 'transform';
        dragStartRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            initialX: obj.transform.x,
            initialY: obj.transform.y,
        };
    };
    const handlePointerMove = (e) => {
        if (!dragStartRef.current || !elRef.current)
            return;
        // Convert screen pixel delta to logical canvas units
        const currentScale = scale || 1;
        const dx = (e.clientX - dragStartRef.current.startX) / currentScale;
        const dy = (e.clientY - dragStartRef.current.startY) / currentScale;
        const nextX = Math.round(dragStartRef.current.initialX + dx);
        const nextY = Math.round(dragStartRef.current.initialY + dy);
        // Apply transform directly to style ref - 60fps interaction without React re-renders
        elRef.current.style.transform = `translate3d(${nextX}px, ${nextY}px, 0px) rotate(${obj.transform.rotation}deg)`;
    };
    const handlePointerUp = (e) => {
        if (!dragStartRef.current || !elRef.current)
            return;
        const currentScale = scale || 1;
        const dx = (e.clientX - dragStartRef.current.startX) / currentScale;
        const dy = (e.clientY - dragStartRef.current.startY) / currentScale;
        elRef.current.releasePointerCapture(e.pointerId);
        elRef.current.style.willChange = 'auto';
        const finalX = Math.round(dragStartRef.current.initialX + dx);
        const finalY = Math.round(dragStartRef.current.initialY + dy);
        dragStartRef.current = null;
        onCommit({
            ...obj.transform,
            x: finalX,
            y: finalY,
        });
    };
    const renderContent = () => {
        if (obj.type === 'image' && obj.assetId) {
            return (_jsx("img", { src: `/api/assets/${obj.assetId}/thumb?size=320`, alt: "Layer object", style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: RADIUS_TOKENS.sm }, draggable: false }));
        }
        if (obj.type === 'sticker') {
            return (_jsx("div", { style: {
                    width: '100%',
                    height: '100%',
                    backgroundColor: COLOR_TOKENS.terracottaLight,
                    color: COLOR_TOKENS.terracotta,
                    border: `2px dashed ${COLOR_TOKENS.terracotta}`,
                    borderRadius: RADIUS_TOKENS.sm,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600,
                    fontSize: '16px',
                    userSelect: 'none',
                }, children: obj.text || '★ Sticker' }));
        }
        return (_jsx("div", { style: {
                width: '100%',
                height: '100%',
                backgroundColor: COLOR_TOKENS.mossLight,
                color: COLOR_TOKENS.moss,
                border: `1px solid ${COLOR_TOKENS.moss}`,
                borderRadius: RADIUS_TOKENS.sm,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '8px',
                userSelect: 'none',
            }, children: obj.text || `Object (${obj.type})` }));
    };
    return (_jsx("div", { ref: elRef, "data-testid": `layer-object-${obj.id}`, onPointerDown: handlePointerDown, onPointerMove: handlePointerMove, onPointerUp: handlePointerUp, style: {
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${obj.transform.width}px`,
            height: `${obj.transform.height}px`,
            transform: `translate3d(${obj.transform.x}px, ${obj.transform.y}px, 0px) rotate(${obj.transform.rotation}deg)`,
            transformOrigin: 'center center',
            cursor: 'grab',
            touchAction: 'none',
            outline: isSelected ? `2px solid ${COLOR_TOKENS.terracotta}` : 'none',
            outlineOffset: '2px',
            userSelect: 'none',
            pointerEvents: 'auto',
        }, children: renderContent() }));
});
DraggableItem.displayName = 'DraggableItem';
export const OverlayLayer = ({ objects, onUpdateObject, selectedId, onSelect, scale = 1, }) => {
    return (_jsx("div", { id: "overlay-layer-surface", "data-testid": "overlay-layer", style: {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
        }, children: objects.map((obj) => (_jsx(DraggableItem, { obj: obj, scale: scale, isSelected: selectedId === obj.id, onSelect: () => onSelect(obj.id), onCommit: (t) => onUpdateObject(obj.id, t) }, obj.id))) }));
};
