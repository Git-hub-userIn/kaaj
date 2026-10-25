import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import FontFamily from '@tiptap/extension-font-family';

import {
  COLOR_TOKENS,
  TYPOGRAPHY_TOKENS,
  SPACING_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
} from '@kaaj/design';
import {
  ENTRY_SIZE_LIMITS,
  type DocumentEnvelopeV2,
  type EntryStats,
} from '@kaaj/doc-model';

import { UniqueIdExtension } from './extensions/unique-id.js';
import { FontSizeExtension } from './extensions/font-size.js';
import { sanitizePastedHtml } from './paste-sanitizer.js';
import { SelectionToolbar } from './SelectionToolbar.js';
import { SlashMenu } from './SlashMenu.js';
import {
  loadEntryDocument,
  saveEntryDocument,
  type LoadedEntry,
} from './storage/entry-storage.js';
import {
  saveDraft,
  getDraft,
  deleteDraft,
  type EntryDraft,
} from './storage/draft-store.js';
import { ensureFontLoaded } from './font-loader.js';
import { ArrowLeft, AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react';

export interface EntryEditorScreenProps {
  entryId: string;
  onNavigateBack: () => void;
  onNavigateToCategory?: (categoryId: string) => void;
}

type SaveStatusState = 'saved' | 'saving' | 'error';

export const EntryEditorScreen: React.FC<EntryEditorScreenProps> = ({
  entryId,
  onNavigateBack,
  onNavigateToCategory,
}) => {
  const [entry, setEntry] = useState<LoadedEntry | null>(null);
  const [title, setTitle] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatusState>('saved');
  const [saveStatusText, setSaveStatusText] = useState('Saved · just now');
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);

  // 409 conflict state
  const [conflictState, setConflictState] = useState<{
    serverVersion: number;
    localDoc: DocumentEnvelopeV2;
    localTitle: string;
  } | null>(null);

  // Restorable draft state
  const [pendingDraft, setPendingDraft] = useState<EntryDraft | null>(null);

  // Slash menu state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashCoords, setSlashCoords] = useState<{ x: number; y: number } | null>(null);
  const [slashQuery, setSlashQuery] = useState('');

  // Refs for autosave orchestration
  const entryRef = useRef<LoadedEntry | null>(null);
  const titleRef = useRef('');
  const lastSavedHashRef = useRef<string>('');
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const retryCountRef = useRef(0);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);

  entryRef.current = entry;
  titleRef.current = title;

  // Initialize Newsreader font face
  useEffect(() => {
    ensureFontLoaded('classic-serif');
    ensureFontLoaded('clean-sans');
  }, []);

  // Compute fast hash of title and document JSON to avoid redundant saves
  const computeDocHash = useCallback((docTitle: string, docEnvelope: DocumentEnvelopeV2): string => {
    return JSON.stringify({ t: docTitle, d: docEnvelope });
  }, []);

  // Check document size limits
  const checkSizeLimits = useCallback((docEnvelope: DocumentEnvelopeV2): boolean => {
    const jsonStr = JSON.stringify(docEnvelope);
    const bytes = new Blob([jsonStr]).size;

    if (bytes > ENTRY_SIZE_LIMITS.MAX_BYTES) {
      setSizeError('Entry exceeds 2 MB limit. Changes cannot be saved until content is reduced.');
      setSizeWarning(null);
      return false;
    }
    if (bytes > ENTRY_SIZE_LIMITS.WARNING_BYTES) {
      setSizeWarning('This entry is getting large (over 1 MB). Consider starting a new entry soon.');
      setSizeError(null);
    } else {
      setSizeWarning(null);
      setSizeError(null);
    }
    return true;
  }, []);

  // Tiptap Editor instance
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: true,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
        },
        validate: (href) => /^(https?:\/\/|mailto:)/i.test(href),
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      FontFamily,
      FontSizeExtension,
      UniqueIdExtension,
    ],
    editorProps: {
      attributes: {
        'aria-label': 'Entry text',
        role: 'textbox',
        class: 'kaaj-editor-content',
        style: 'outline: none; min-height: 480px;',
      },
      transformPastedHTML(html) {
        return sanitizePastedHtml(html);
      },
      handleKeyDown(_view, event) {
        if (event.key === 'Escape') {
          setSlashMenuOpen(false);
        }
        return false;
      },
    },
    onUpdate({ editor: currentEditor }) {
      const currentDoc: DocumentEnvelopeV2 = {
        schemaVersion: 2,
        doc: currentEditor.getJSON() as any,
      };

      // Check size
      checkSizeLimits(currentDoc);

      // Save draft to IndexedDB (debounced 300 ms)
      if (entryRef.current) {
        const draft: EntryDraft = {
          entryId: entryRef.current.id,
          title: titleRef.current,
          doc: currentDoc,
          baseVersion: entryRef.current.version,
          updatedAt: Date.now(),
        };
        saveDraft(draft);
      }

      // Check for slash menu trigger
      const { selection } = currentEditor.state;
      const { from } = selection;
      const textBefore = currentEditor.state.doc.textBetween(
        Math.max(0, from - 20),
        from,
        '\n',
        '\0'
      );
      const match = textBefore.match(/\/([a-zA-Z0-9-]*)$/);

      if (match) {
        const coords = currentEditor.view.coordsAtPos(from);
        setSlashCoords({ x: coords.left, y: coords.bottom });
        setSlashQuery(match[1]);
        setSlashMenuOpen(true);
      } else {
        setSlashMenuOpen(false);
      }

      // Trigger autosave timers
      triggerAutosaveTimers();
    },
  });

  // Core save routine
  const performSave = useCallback(
    async (options?: { keepalive?: boolean }) => {
      const currentEntry = entryRef.current;
      if (!currentEntry || !editor) return;

      if (isSavingRef.current) {
        saveQueuedRef.current = true;
        return;
      }

      const currentDoc: DocumentEnvelopeV2 = {
        schemaVersion: 2,
        doc: editor.getJSON() as any,
      };

      // If document is over hard limit, block save
      if (!checkSizeLimits(currentDoc)) {
        setSaveStatus('error');
        setSaveStatusText("Couldn't save · Over 2 MB limit");
        return;
      }

      const currentTitle = titleRef.current;
      const currentHash = computeDocHash(currentTitle, currentDoc);

      // Skip save if nothing changed
      if (currentHash === lastSavedHashRef.current) {
        setSaveStatus('saved');
        setSaveStatusText('Saved · just now');
        return;
      }

      // Clear any pending timers
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      idleTimerRef.current = null;
      maxTimerRef.current = null;

      isSavingRef.current = true;
      setSaveStatus('saving');
      setSaveStatusText('Saving...');

      try {
        const result = await saveEntryDocument(
          currentEntry.id,
          currentDoc,
          currentEntry.version,
          currentTitle,
          options
        );

        if (result.conflict) {
          // 409 conflict
          isSavingRef.current = false;
          setSaveStatus('error');
          setSaveStatusText("Couldn't save · Conflict");
          setConflictState({
            serverVersion: result.currentVersion ?? currentEntry.version + 1,
            localDoc: currentDoc,
            localTitle: currentTitle,
          });
          return;
        }

        // Save succeeded
        lastSavedHashRef.current = currentHash;
        retryCountRef.current = 0;
        setEntry((prev) =>
          prev
            ? {
                ...prev,
                version: result.version,
                weight: result.weight,
                stats: result.stats || prev.stats,
                title: result.title || currentTitle,
                doc: currentDoc,
              }
            : null
        );

        // Delete confirmed draft from IndexedDB
        deleteDraft(currentEntry.id);

        setSaveStatus('saved');
        setSaveStatusText('Saved · just now');
      } catch (err) {
        console.warn('Save failed:', err);
        setSaveStatus('error');
        setSaveStatusText("Couldn't save · Retry");

        // Retry with backoff if network failure
        const nextRetry = Math.min(3, retryCountRef.current + 1);
        retryCountRef.current = nextRetry;
        const delay = Math.pow(2, nextRetry) * 1000;
        setTimeout(() => {
          if (saveStatus === 'error') {
            performSave();
          }
        }, delay);
      } finally {
        isSavingRef.current = false;
        if (saveQueuedRef.current) {
          saveQueuedRef.current = false;
          performSave();
        }
      }
    },
    [editor, computeDocHash, checkSizeLimits, saveStatus]
  );

  // Autosave timers: 1.5s idle, at most 10s of changes
  const triggerAutosaveTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      performSave();
    }, 1500);

    if (!maxTimerRef.current) {
      maxTimerRef.current = setTimeout(() => {
        performSave();
      }, 10000);
    }
  }, [performSave]);

  // Load entry on mount
  useEffect(() => {
    let isCancelled = false;

    async function init() {
      try {
        const loaded = await loadEntryDocument(entryId);
        if (isCancelled) return;

        setEntry(loaded);
        setTitle(loaded.title);
        lastSavedHashRef.current = computeDocHash(loaded.title, loaded.doc);

        if (editor) {
          editor.commands.setContent(loaded.doc.doc as any);
        }

        // Check if there is an uncommitted newer draft in IndexedDB
        const draft = await getDraft(entryId);
        if (draft && draft.doc) {
          const draftHash = computeDocHash(draft.title, draft.doc);
          const serverHash = computeDocHash(loaded.title, loaded.doc);
          if (draftHash !== serverHash) {
            setPendingDraft(draft);
          }
        }

        // Focus title on new untitled entry
        if (!loaded.title || loaded.title === 'Untitled') {
          setTimeout(() => titleInputRef.current?.focus(), 50);
        }
      } catch (err: any) {
        console.error('Failed to load entry:', err);
        const draft = await getDraft(entryId);
        if (draft && draft.doc) {
          const fallbackEntry: LoadedEntry = {
            id: entryId,
            categoryId: 'cat_ideas',
            title: draft.title,
            version: draft.baseVersion,
            weight: 1,
            doc: draft.doc,
          };
          setEntry(fallbackEntry);
          setTitle(draft.title);
          lastSavedHashRef.current = '';
          if (editor) {
            editor.commands.setContent(draft.doc.doc as any);
          }
          setPendingDraft(draft);
        }
        setSaveStatus('error');
        setSaveStatusText("Couldn't save · Retry");
      }
    }

    init();

    return () => {
      isCancelled = true;
    };
  }, [entryId, editor, computeDocHash]);

  // Save on blur, visibilitychange, and pagehide
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        performSave({ keepalive: true });
      }
    };

    const handlePageHide = () => {
      performSave({ keepalive: true });
    };

    const handleWindowBlur = () => {
      performSave();
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [performSave]);

  // Global Ctrl/Cmd+S keyboard shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        performSave();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [performSave]);

  // Auto-resize title textarea height
  useEffect(() => {
    if (titleInputRef.current) {
      titleInputRef.current.style.height = 'auto';
      titleInputRef.current.style.height = `${titleInputRef.current.scrollHeight}px`;
    }
  }, [title]);

  // Handle Title input change
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    if (entryRef.current && editor) {
      const currentDoc: DocumentEnvelopeV2 = {
        schemaVersion: 2,
        doc: editor.getJSON() as any,
      };
      saveDraft({
        entryId: entryRef.current.id,
        title: newTitle,
        doc: currentDoc,
        baseVersion: entryRef.current.version,
        updatedAt: Date.now(),
      });
    }
    triggerAutosaveTimers();
  };

  // Move focus from Title to body on Enter
  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      editor?.commands.focus('start');
    }
  };

  // Resolve 409 conflict
  const handleResolveConflict = async (action: 'keep-mine' | 'load-server') => {
    if (!conflictState) return;
    if (action === 'load-server') {
      try {
        const fresh = await loadEntryDocument(entryId);
        setEntry(fresh);
        setTitle(fresh.title);
        lastSavedHashRef.current = computeDocHash(fresh.title, fresh.doc);
        editor?.commands.setContent(fresh.doc.doc as any);
        deleteDraft(entryId);
        setConflictState(null);
        setSaveStatus('saved');
        setSaveStatusText('Saved · just now');
      } catch (err) {
        console.warn('Failed to load server version:', err);
      }
    } else {
      // Keep mine: adopt serverVersion as base and save mine immediately
      if (entry) {
        setEntry({ ...entry, version: conflictState.serverVersion });
      }
      setConflictState(null);
      setTimeout(() => performSave(), 50);
    }
  };

  // Restore draft banner actions
  const handleRestoreDraft = () => {
    if (!pendingDraft || !editor) return;
    setTitle(pendingDraft.title);
    editor.commands.setContent(pendingDraft.doc.doc as any);
    setPendingDraft(null);
    triggerAutosaveTimers();
  };

  const handleDismissDraft = () => {
    deleteDraft(entryId);
    setPendingDraft(null);
  };

  return (
    <div
      data-testid="entry-editor-screen"
      style={{
        minHeight: '100vh',
        backgroundColor: COLOR_TOKENS.paper,
        color: COLOR_TOKENS.ink,
        fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '24px 16px 80px',
        boxSizing: 'border-box',
      }}
    >
      <style>{`
        /* Type scale rules */
        .kaaj-editor-content {
          font-family: ${TYPOGRAPHY_TOKENS.fontFamilySerif};
          font-size: 18px;
          line-height: 1.7;
          color: ${COLOR_TOKENS.ink};
        }
        @media (max-width: 767px) {
          .kaaj-editor-content {
            font-size: 17px;
          }
        }
        .kaaj-editor-content h1 {
          font-size: 36px;
          line-height: 1.25;
          margin-top: 1.6em;
          margin-bottom: 0.6em;
          font-weight: 700;
        }
        .kaaj-editor-content h2 {
          font-size: 28px;
          line-height: 1.3;
          margin-top: 1.4em;
          margin-bottom: 0.5em;
          font-weight: 600;
        }
        .kaaj-editor-content h3 {
          font-size: 22px;
          line-height: 1.35;
          margin-top: 1.2em;
          margin-bottom: 0.4em;
          font-weight: 600;
        }
        .kaaj-editor-content p {
          margin-top: 0.8em;
          margin-bottom: 0.8em;
        }
        .kaaj-editor-content ul {
          list-style-type: disc;
          padding-left: 1.5em;
          margin: 0.8em 0;
        }
        .kaaj-editor-content ol {
          list-style-type: decimal;
          padding-left: 1.5em;
          margin: 0.8em 0;
        }
        .kaaj-editor-content li {
          margin-bottom: 0.3em;
        }
        .kaaj-editor-content blockquote {
          border-left: 3px solid ${COLOR_TOKENS.border};
          padding-left: 16px;
          margin: 1.2em 0;
          font-style: italic;
          color: ${COLOR_TOKENS.inkMuted};
        }
        .kaaj-editor-content hr {
          border: none;
          border-top: 1px solid ${COLOR_TOKENS.border};
          margin: 2em 0;
        }
        .kaaj-editor-content a {
          color: ${COLOR_TOKENS.terracottaDark};
          text-decoration: underline;
          cursor: pointer;
        }
        .kaaj-editor-content a:hover {
          color: ${COLOR_TOKENS.terracotta};
        }
        .kaaj-editor-content mark {
          border-radius: 2px;
          padding: 1px 3px;
        }
      `}</style>

      {/* Main Single Reading Column (Centered, Max Width ~760px) */}
      <div
        style={{
          width: '100%',
          maxWidth: '760px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Top Navigation & Status Bar */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '36px',
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
          }}
        >
          {/* Back to Category Link */}
          <button
            type="button"
            data-testid="entry-back-btn"
            onClick={() => {
              if (entry?.categoryId && onNavigateToCategory) {
                onNavigateToCategory(entry.categoryId);
              } else {
                onNavigateBack();
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: COLOR_TOKENS.inkMuted,
              fontSize: '14px',
              fontWeight: 500,
              padding: '6px 0',
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              transition: 'color 0.15s ease',
            }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Category</span>
          </button>

          {/* Quiet Save Status */}
          <button
            type="button"
            data-testid="save-status-indicator"
            aria-live="polite"
            onClick={() => performSave()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: saveStatus === 'error' ? 'pointer' : 'default',
              color:
                saveStatus === 'error'
                  ? COLOR_TOKENS.terracottaDark
                  : COLOR_TOKENS.inkLight,
              fontSize: '13px',
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              padding: '6px 8px',
              borderRadius: RADIUS_TOKENS.sm,
              textDecoration: saveStatus === 'error' ? 'underline' : 'none',
            }}
          >
            {saveStatus === 'saving' && <RefreshCw size={12} className="spin" aria-hidden="true" />}
            {saveStatus === 'saved' && <CheckCircle2 size={12} aria-hidden="true" />}
            {saveStatus === 'error' && <AlertCircle size={12} aria-hidden="true" />}
            <span>{saveStatusText}</span>
          </button>
        </header>

        {/* 409 Conflict Banner */}
        {conflictState && (
          <div
            role="alert"
            data-testid="conflict-banner"
            style={{
              backgroundColor: COLOR_TOKENS.paperSubtle,
              border: `1.5px solid ${COLOR_TOKENS.terracotta}`,
              borderRadius: RADIUS_TOKENS.md,
              padding: '14px 18px',
              marginBottom: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
            }}
          >
            <div style={{ fontWeight: 600, color: COLOR_TOKENS.terracottaDark, fontSize: '14px' }}>
              Version Conflict
            </div>
            <div style={{ fontSize: '13px', color: COLOR_TOKENS.ink, lineHeight: 1.4 }}>
              Another edit was saved to this entry. Choose which version to keep; neither will be lost.
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
              <button
                type="button"
                data-testid="conflict-load-server-btn"
                onClick={() => handleResolveConflict('load-server')}
                style={{
                  padding: '6px 12px',
                  backgroundColor: COLOR_TOKENS.paperWarm,
                  border: `1px solid ${COLOR_TOKENS.border}`,
                  borderRadius: RADIUS_TOKENS.sm,
                  fontSize: '13px',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Load server version
              </button>
              <button
                type="button"
                data-testid="conflict-keep-mine-btn"
                onClick={() => handleResolveConflict('keep-mine')}
                style={{
                  padding: '6px 12px',
                  backgroundColor: COLOR_TOKENS.ink,
                  color: COLOR_TOKENS.paper,
                  border: 'none',
                  borderRadius: RADIUS_TOKENS.sm,
                  fontSize: '13px',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Keep mine
              </button>
            </div>
          </div>
        )}

        {/* Pending Draft Restore Banner */}
        {pendingDraft && (
          <div
            role="alert"
            data-testid="draft-restore-banner"
            style={{
              backgroundColor: COLOR_TOKENS.paperSubtle,
              border: `1px solid ${COLOR_TOKENS.border}`,
              borderRadius: RADIUS_TOKENS.md,
              padding: '12px 16px',
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
            }}
          >
            <span style={{ fontSize: '13px', color: COLOR_TOKENS.ink }}>
              An unsaved draft exists from earlier. Restore your changes?
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                data-testid="restore-draft-btn"
                onClick={handleRestoreDraft}
                style={{
                  padding: '4px 10px',
                  backgroundColor: COLOR_TOKENS.ink,
                  color: COLOR_TOKENS.paper,
                  border: 'none',
                  borderRadius: RADIUS_TOKENS.sm,
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                Restore
              </button>
              <button
                type="button"
                data-testid="dismiss-draft-btn"
                onClick={handleDismissDraft}
                style={{
                  padding: '4px 10px',
                  backgroundColor: 'transparent',
                  border: `1px solid ${COLOR_TOKENS.border}`,
                  borderRadius: RADIUS_TOKENS.sm,
                  fontSize: '12px',
                  cursor: 'pointer',
                  color: COLOR_TOKENS.inkMuted,
                }}
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {/* Calm Size Warning/Error Messages */}
        {sizeWarning && (
          <div
            role="status"
            data-testid="size-warning-banner"
            style={{
              fontSize: '13px',
              color: COLOR_TOKENS.inkMuted,
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              padding: '8px 12px',
              backgroundColor: COLOR_TOKENS.paperWarm,
              borderRadius: RADIUS_TOKENS.sm,
              marginBottom: '16px',
            }}
          >
            {sizeWarning}
          </div>
        )}
        {sizeError && (
          <div
            role="alert"
            data-testid="size-error-banner"
            style={{
              fontSize: '13px',
              color: COLOR_TOKENS.terracottaDark,
              fontFamily: TYPOGRAPHY_TOKENS.fontFamilySans,
              padding: '8px 12px',
              backgroundColor: COLOR_TOKENS.paperSubtle,
              border: `1px solid ${COLOR_TOKENS.terracotta}`,
              borderRadius: RADIUS_TOKENS.sm,
              marginBottom: '16px',
            }}
          >
            {sizeError}
          </div>
        )}

        {/* Title Field (Large Serif, Placeholder 'Untitled') */}
        <textarea
          ref={titleInputRef}
          rows={1}
          value={title}
          placeholder="Untitled"
          aria-label="Entry title"
          data-testid="entry-title-input"
          onChange={(e) => {
            handleTitleChange(e.target.value);
            // Auto resize height
            e.target.style.height = 'auto';
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onKeyDown={handleTitleKeyDown}
          style={{
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
            fontSize: '36px',
            fontWeight: 700,
            lineHeight: 1.25,
            color: COLOR_TOKENS.ink,
            backgroundColor: 'transparent',
            border: 'none',
            outline: 'none',
            width: '100%',
            marginBottom: '32px',
            padding: 0,
            resize: 'none',
            overflow: 'hidden',
            wordBreak: 'break-word',
          }}
        />

        {/* Body Editor Container */}
        <main
          role="region"
          aria-label="Entry content"
          style={{
            position: 'relative',
            width: '100%',
          }}
        >
          {editor && <SelectionToolbar editor={editor} />}
          {editor && (
            <SlashMenu
              editor={editor}
              isOpen={slashMenuOpen}
              onClose={() => setSlashMenuOpen(false)}
              coords={slashCoords}
              query={slashQuery}
            />
          )}
          <EditorContent editor={editor} />
        </main>
      </div>
    </div>
  );
};
