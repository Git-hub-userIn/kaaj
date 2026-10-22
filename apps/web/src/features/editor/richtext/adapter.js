/**
 * Adapter converting between Tiptap JSON and Kaaj canonical rich-text format.
 * This is the ONLY file in the repository authorized to interact with Tiptap JSON.
 */
export function tiptapToCanonical(tiptapJson) {
    const content = (tiptapJson.content || []).map((node) => {
        if (node.type === 'heading') {
            return {
                type: 'heading',
                level: node.attrs?.level || 1,
                text: node.content?.[0]?.text || '',
            };
        }
        if (node.type === 'paragraph') {
            return {
                type: 'paragraph',
                text: node.content?.[0]?.text || '',
            };
        }
        return {
            type: node.type || 'paragraph',
            text: node.content?.[0]?.text || '',
        };
    });
    return {
        format: 'kaaj-rich-text-v1',
        content,
    };
}
export function canonicalToTiptap(canonical) {
    const content = canonical.content.map((block) => {
        if (block.type === 'heading') {
            return {
                type: 'heading',
                attrs: { level: block.level || 1 },
                content: block.text ? [{ type: 'text', text: block.text }] : [],
            };
        }
        return {
            type: 'paragraph',
            content: block.text ? [{ type: 'text', text: block.text }] : [],
        };
    });
    return {
        type: 'doc',
        content: content.length > 0 ? content : [{ type: 'paragraph' }],
    };
}
