import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ImageBlockView } from './ImageBlockView.js';

export interface ImageBlockOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imageBlock: {
      setImageBlock: (options: { assetId: string; alt?: string; width?: number }) => ReturnType;
    };
  }
}

export const ImageBlockExtension = Node.create<ImageBlockOptions>({
  name: 'image',
  group: 'block',
  selectable: true,
  draggable: true,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id') || element.getAttribute('id'),
        renderHTML: (attributes) => attributes.id ? { id: attributes.id, 'data-block-id': attributes.id } : {},
      },
      assetId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-asset-id') || '',
        renderHTML: (attributes) => ({ 'data-asset-id': attributes.assetId }),
      },
      alt: {
        default: '',
        parseHTML: (element) => element.getAttribute('alt') || '',
        renderHTML: (attributes) => ({ alt: attributes.alt || '' }),
      },
      width: {
        default: 1.0,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-width');
          if (raw) {
            const num = parseFloat(raw);
            return num > 1 ? num / 100 : num;
          }
          return 1.0;
        },
        renderHTML: (attributes) => ({
          'data-width': Math.round((attributes.width || 1.0) * 100),
          style: `width: ${Math.round((attributes.width || 1.0) * 100)}%;`,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-asset-id]',
      },
      {
        tag: 'img[data-asset-id]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': 'image' })];
  },

  addCommands() {
    return {
      setImageBlock:
        (options) =>
        ({ commands }) => {
          const blockId = `b_${crypto.randomUUID()}`;
          return commands.insertContent({
            type: this.name,
            attrs: {
              id: blockId,
              assetId: options.assetId,
              alt: options.alt || '',
              width: options.width ?? 1.0,
            },
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView);
  },
});
