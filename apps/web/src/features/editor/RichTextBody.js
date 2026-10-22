import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { COLOR_TOKENS, TYPOGRAPHY_TOKENS, SPACING_TOKENS } from '@kaaj/design';
import { canonicalToTiptap, tiptapToCanonical } from './richtext/adapter.js';
export const RichTextBodyView = ({ initialContent, onChange }) => {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: {
                    levels: [1, 2, 3],
                },
            }),
        ],
        content: canonicalToTiptap(initialContent),
        onUpdate: ({ editor: ed }) => {
            const canonical = tiptapToCanonical(ed.getJSON());
            onChange(canonical);
        },
    });
    useEffect(() => {
        if (editor && initialContent) {
            const currentCanonical = tiptapToCanonical(editor.getJSON());
            if (JSON.stringify(currentCanonical) !== JSON.stringify(initialContent)) {
                editor.commands.setContent(canonicalToTiptap(initialContent));
            }
        }
    }, [initialContent, editor]);
    return (_jsxs("div", { style: {
            padding: `${SPACING_TOKENS.xxl} ${SPACING_TOKENS.xl}`,
            width: '100%',
            height: '100%',
            color: COLOR_TOKENS.ink,
            fontFamily: TYPOGRAPHY_TOKENS.fontFamilySerif,
            fontSize: TYPOGRAPHY_TOKENS.fontSize.lg,
            lineHeight: 1.6,
        }, children: [_jsx("style", { children: `
        .ProseMirror {
          outline: none;
          min-height: 500px;
        }
        .ProseMirror h1 {
          font-family: ${TYPOGRAPHY_TOKENS.fontFamilySans};
          font-size: ${TYPOGRAPHY_TOKENS.fontSize.heading1};
          color: ${COLOR_TOKENS.terracotta};
          margin-top: 0;
          margin-bottom: ${SPACING_TOKENS.md};
          font-weight: 600;
        }
        .ProseMirror h2 {
          font-family: ${TYPOGRAPHY_TOKENS.fontFamilySans};
          font-size: ${TYPOGRAPHY_TOKENS.fontSize.heading2};
          color: ${COLOR_TOKENS.indigo};
          margin-top: ${SPACING_TOKENS.lg};
          margin-bottom: ${SPACING_TOKENS.sm};
          font-weight: 500;
        }
        .ProseMirror p {
          margin-top: 0;
          margin-bottom: ${SPACING_TOKENS.md};
        }
      ` }), _jsx(EditorContent, { editor: editor, "data-testid": "richtext-editor" })] }));
};
