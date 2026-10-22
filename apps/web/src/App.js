import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import { CanvasContainer } from './features/editor/CanvasContainer.js';
import { RichTextBodyView } from './features/editor/RichTextBody.js';
import { OverlayLayer } from './features/editor/OverlayLayer.js';
import { COLOR_TOKENS, TYPOGRAPHY_TOKENS, SPACING_TOKENS, RADIUS_TOKENS } from '@kaaj/design';
const INITIAL_DOC = {
    schemaVersion: 1,
    pages: [
        {
            id: 'page_1',
            size: { width: 1200, height: 1600 },
            background: { type: 'solid', token: 'paper' },
            body: {
                format: 'kaaj-rich-text-v1',
                content: [
                    { type: 'heading', level: 1, text: 'Kaaj Visual Journal' },
                    {
                        type: 'paragraph',
                        text: 'Kaaj is a handmade visual archive and journal. Writing comes first, decoration optional.',
                    },
                    {
                        type: 'paragraph',
                        text: 'This prototype verifies fixed 3:4 ratio scaling, rich text editing, freeform layer transforms, and fast persistence.',
                    },
                ],
            },
            layers: [
                {
                    id: 'layer_1',
                    name: 'Decorations',
                    visible: true,
                    locked: false,
                    objects: [
                        {
                            id: 'obj_sticker_1',
                            type: 'sticker',
                            text: '★ Handmade Archive',
                            transform: { x: 750, y: 150, width: 260, height: 90, rotation: -4 },
                            anchor: { type: 'page' },
                            style: {},
                        },
                    ],
                },
            ],
        },
    ],
};
export const App = () => {
    const [doc, setDoc] = useState(INITIAL_DOC);
    const [saveStatus, setSaveStatus] = useState('Saved');
    const [selectedObjectId, setSelectedObjectId] = useState(null);
    const [isBenchmarkActive, setIsBenchmarkActive] = useState(false);
    const [fps, setFps] = useState(60);
    const [lastSavedWeight, setLastSavedWeight] = useState(1);
    const [version, setVersion] = useState(1);
    const fileInputRef = useRef(null);
    // FPS calculation loop during active interaction
    useEffect(() => {
        let frameCount = 0;
        let lastTime = performance.now();
        let animId;
        const measureFps = () => {
            frameCount++;
            const now = performance.now();
            if (now - lastTime >= 1000) {
                setFps(Math.round((frameCount * 1000) / (now - lastTime)));
                frameCount = 0;
                lastTime = now;
            }
            animId = requestAnimationFrame(measureFps);
        };
        animId = requestAnimationFrame(measureFps);
        return () => cancelAnimationFrame(animId);
    }, []);
    const currentPage = doc.pages[0];
    const currentObjects = currentPage.layers[0]?.objects || [];
    const handleUpdateRichText = (newBody) => {
        setDoc((prev) => ({
            ...prev,
            pages: [
                {
                    ...prev.pages[0],
                    body: newBody,
                },
            ],
        }));
        setSaveStatus('Saving');
        // Debounce save simulation
        setTimeout(() => setSaveStatus('Saved'), 1000);
    };
    const handleUpdateObjectTransform = (id, nextTransform) => {
        setDoc((prev) => {
            const page = prev.pages[0];
            const layer = page.layers[0];
            const updatedObjects = layer.objects.map((o) => o.id === id ? { ...o, transform: nextTransform } : o);
            return {
                ...prev,
                pages: [
                    {
                        ...page,
                        layers: [{ ...layer, objects: updatedObjects }],
                    },
                ],
            };
        });
    };
    const handleToggleBenchmark = () => {
        if (isBenchmarkActive) {
            // Revert to original single sticker
            setDoc(INITIAL_DOC);
            setIsBenchmarkActive(false);
            return;
        }
        // Generate 200 lightweight objects distributed across the 1200x1600 canvas
        const objects200 = [];
        for (let i = 0; i < 200; i++) {
            const col = i % 10;
            const row = Math.floor(i / 10);
            objects200.push({
                id: `bench_obj_${i}`,
                type: 'shape',
                text: `#${i + 1}`,
                transform: {
                    x: 40 + col * 112,
                    y: 40 + row * 76,
                    width: 90,
                    height: 60,
                    rotation: (i % 7) - 3,
                },
                anchor: { type: 'page' },
                style: {},
            });
        }
        setDoc((prev) => ({
            ...prev,
            pages: [
                {
                    ...prev.pages[0],
                    layers: [{ ...prev.pages[0].layers[0], objects: objects200 }],
                },
            ],
        }));
        setIsBenchmarkActive(true);
    };
    const handleUploadImage = async (e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        const formData = new FormData();
        formData.append('file', file);
        try {
            setSaveStatus('Saving');
            const res = await fetch('/api/assets', {
                method: 'POST',
                body: formData,
            });
            if (!res.ok) {
                throw new Error(`Upload failed: ${res.statusText}`);
            }
            const data = await res.json();
            const asset = data.asset;
            // Add image to layer
            const newImageObject = {
                id: `img_${Date.now()}`,
                type: 'image',
                assetId: asset.id,
                transform: {
                    x: 200,
                    y: 300,
                    width: 320,
                    height: Math.round(320 * ((asset.height || 240) / (asset.width || 320))),
                    rotation: 0,
                },
                anchor: { type: 'page' },
                style: {},
            };
            setDoc((prev) => {
                const page = prev.pages[0];
                const layer = page.layers[0];
                return {
                    ...prev,
                    pages: [
                        {
                            ...page,
                            layers: [{ ...layer, objects: [...layer.objects, newImageObject] }],
                        },
                    ],
                };
            });
            setSaveStatus('Saved');
        }
        catch (err) {
            console.error(err);
            setSaveStatus("Couldn't save");
        }
    };
    const handleSaveToServer = async () => {
        try {
            setSaveStatus('Saving');
            const res = await fetch('/api/entries/spike-1', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer kaaj-local-dev-token',
                },
                body: JSON.stringify({ doc }),
            });
            if (!res.ok) {
                throw new Error('Save failed');
            }
            const result = await res.json();
            setVersion(result.version);
            setLastSavedWeight(result.weight);
            setSaveStatus('Saved');
        }
        catch {
            setSaveStatus("Couldn't save");
        }
    };
    const handleReloadFromServer = async () => {
        try {
            const res = await fetch('/api/entries/spike-1', {
                headers: {
                    Authorization: 'Bearer kaaj-local-dev-token',
                },
            });
            if (!res.ok) {
                alert('No saved document found on server yet.');
                return;
            }
            const result = await res.json();
            setDoc(result.doc);
            setVersion(result.version);
            setLastSavedWeight(result.weight);
            setSaveStatus('Saved');
        }
        catch (err) {
            console.error(err);
        }
    };
    const handleExportPdf = async () => {
        const canvasElement = document.getElementById('canvas-logical-page');
        if (!canvasElement)
            return;
        const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { margin: 0; padding: 0; font-family: sans-serif; background: #fcfbf7; }
            #page { width: 1200px; height: 1600px; position: relative; overflow: hidden; background: #fcfbf7; }
          </style>
        </head>
        <body>
          <div id="page">
            ${canvasElement.innerHTML}
          </div>
        </body>
      </html>
    `;
        const res = await fetch('/api/export/pdf', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer kaaj-local-dev-token',
            },
            body: JSON.stringify({ htmlContent }),
        });
        if (!res.ok) {
            alert('PDF export failed');
            return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'kaaj-spike-export.pdf';
        a.click();
        URL.revokeObjectURL(url);
    };
    return (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }, children: [_jsxs("header", { style: {
                    height: '64px',
                    backgroundColor: COLOR_TOKENS.paper,
                    borderBottom: `1px solid ${COLOR_TOKENS.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: `0 ${SPACING_TOKENS.lg}`,
                    zIndex: 10,
                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: SPACING_TOKENS.md }, children: [_jsxs("h1", { style: {
                                    margin: 0,
                                    fontSize: TYPOGRAPHY_TOKENS.fontSize.xl,
                                    fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
                                    color: COLOR_TOKENS.terracotta,
                                    fontWeight: 700,
                                }, children: ["Kaaj ", _jsx("span", { style: { fontSize: '13px', color: COLOR_TOKENS.inkMuted, fontWeight: 400 }, children: "Spike v0.1" })] }), _jsxs("span", { "data-testid": "save-status", style: {
                                    fontSize: TYPOGRAPHY_TOKENS.fontSize.xs,
                                    padding: '3px 8px',
                                    borderRadius: RADIUS_TOKENS.sm,
                                    backgroundColor: saveStatus === 'Saved'
                                        ? COLOR_TOKENS.mossLight
                                        : saveStatus === 'Saving'
                                            ? COLOR_TOKENS.amberLight
                                            : COLOR_TOKENS.terracottaLight,
                                    color: saveStatus === 'Saved'
                                        ? COLOR_TOKENS.moss
                                        : saveStatus === 'Saving'
                                            ? COLOR_TOKENS.amber
                                            : COLOR_TOKENS.terracotta,
                                    fontWeight: 500,
                                }, children: [saveStatus, " (v", version, ", weight: ", lastSavedWeight, ")"] }), _jsxs("span", { "data-testid": "fps-meter", style: {
                                    fontSize: TYPOGRAPHY_TOKENS.fontSize.xs,
                                    color: fps >= 50 ? COLOR_TOKENS.moss : COLOR_TOKENS.amber,
                                    fontFamily: TYPOGRAPHY_TOKENS.fontFamilyMono,
                                    marginLeft: '8px',
                                }, children: [fps, " FPS (", currentObjects.length, " objects)"] })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: SPACING_TOKENS.sm }, children: [_jsx("input", { type: "file", ref: fileInputRef, onChange: handleUploadImage, accept: "image/png,image/jpeg,image/webp,image/gif", style: { display: 'none' } }), _jsx("button", { onClick: () => fileInputRef.current?.click(), style: {
                                    padding: '6px 12px',
                                    backgroundColor: COLOR_TOKENS.paperSubtle,
                                    border: `1px solid ${COLOR_TOKENS.border}`,
                                    borderRadius: RADIUS_TOKENS.sm,
                                    cursor: 'pointer',
                                    fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
                                }, children: "+ Upload Image" }), _jsx("button", { "data-testid": "toggle-benchmark-btn", onClick: handleToggleBenchmark, style: {
                                    padding: '6px 12px',
                                    backgroundColor: isBenchmarkActive ? COLOR_TOKENS.indigoLight : COLOR_TOKENS.paperSubtle,
                                    border: `1px solid ${COLOR_TOKENS.border}`,
                                    borderRadius: RADIUS_TOKENS.sm,
                                    cursor: 'pointer',
                                    fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
                                    color: isBenchmarkActive ? COLOR_TOKENS.indigo : COLOR_TOKENS.ink,
                                    fontWeight: isBenchmarkActive ? 600 : 400,
                                }, children: isBenchmarkActive ? 'Reset Benchmark' : 'Test 200 Objects' }), _jsx("button", { "data-testid": "save-btn", onClick: handleSaveToServer, style: {
                                    padding: '6px 14px',
                                    backgroundColor: COLOR_TOKENS.terracotta,
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: RADIUS_TOKENS.sm,
                                    cursor: 'pointer',
                                    fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
                                    fontWeight: 600,
                                }, children: "Save" }), _jsx("button", { "data-testid": "reload-btn", onClick: handleReloadFromServer, style: {
                                    padding: '6px 12px',
                                    backgroundColor: COLOR_TOKENS.paperSubtle,
                                    border: `1px solid ${COLOR_TOKENS.border}`,
                                    borderRadius: RADIUS_TOKENS.sm,
                                    cursor: 'pointer',
                                    fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
                                }, children: "Reload" }), _jsx("button", { "data-testid": "export-pdf-btn", onClick: handleExportPdf, style: {
                                    padding: '6px 12px',
                                    backgroundColor: COLOR_TOKENS.slate,
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: RADIUS_TOKENS.sm,
                                    cursor: 'pointer',
                                    fontSize: TYPOGRAPHY_TOKENS.fontSize.sm,
                                }, children: "PDF Export" })] })] }), _jsx("main", { style: { flex: 1, position: 'relative' }, children: _jsxs(CanvasContainer, { children: [_jsx(RichTextBodyView, { initialContent: currentPage.body, onChange: handleUpdateRichText }), _jsx(OverlayLayer, { objects: currentObjects, selectedId: selectedObjectId, onSelect: setSelectedObjectId, onUpdateObject: handleUpdateObjectTransform })] }) })] }));
};
