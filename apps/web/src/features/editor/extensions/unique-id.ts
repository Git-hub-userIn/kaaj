import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export const UniqueIdExtension = Extension.create({
  name: 'uniqueId',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule'],
        attributes: {
          id: {
            default: () => `b_${crypto.randomUUID()}`,
            parseHTML: (element) => element.getAttribute('data-block-id') || element.getAttribute('id'),
            renderHTML: (attributes) => {
              if (!attributes.id) return {};
              return { 'data-block-id': attributes.id };
            },
            keepOnSplit: false,
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('uniqueIdPlugin'),
        appendTransaction(_transactions, _oldState, newState) {
          const tr = newState.tr;
          let modified = false;
          const seenIds = new Set<string>();

          newState.doc.forEach((node, offset) => {
            const currentId = node.attrs?.id;
            if (!currentId || seenIds.has(currentId)) {
              const newId = `b_${crypto.randomUUID()}`;
              tr.setNodeMarkup(offset, undefined, {
                ...node.attrs,
                id: newId,
              });
              seenIds.add(newId);
              modified = true;
            } else {
              seenIds.add(currentId);
            }
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});
