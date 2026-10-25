/**
 * Whitelist HTML sanitizer for editor paste events.
 * Strips scripts, styles, iframes, images, and unknown tags while preserving allowed rich text.
 */

const ALLOWED_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'ul',
  'ol',
  'li',
  'blockquote',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'a',
  'span',
]);

const ALLOWED_STYLES = new Set([
  'color',
  'font-family',
  'font-size',
  'text-align',
]);

export function sanitizePastedHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';
  if (typeof DOMParser === 'undefined') return html;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove dangerous tags and anything outside whitelist
    const cleanNode = (node: Node) => {
      // Process children first
      const children = Array.from(node.childNodes);
      for (const child of children) {
        cleanNode(child);
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();

        // 1. Forbidden elements to remove entirely (including content)
        if (['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'meta', 'link'].includes(tag)) {
          el.remove();
          return;
        }

        // 2. Elements not in whitelist (like img, table, div) -> unwrap or remove
        if (!ALLOWED_TAGS.has(tag)) {
          if (tag === 'img' || tag === 'video' || tag === 'audio' || tag === 'svg') {
            el.remove();
            return;
          }
          // Unwrap container elements (e.g., div, section, article)
          const parent = el.parentNode;
          if (parent) {
            while (el.firstChild) {
              parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
          }
          return;
        }

        // 3. Clean attributes
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
          const name = attr.name.toLowerCase();

          // Strip all on* attributes
          if (name.startsWith('on')) {
            el.removeAttribute(attr.name);
            continue;
          }

          if (tag === 'a') {
            if (name === 'href') {
              const val = attr.value.trim();
              if (!/^(https?:\/\/|mailto:)/i.test(val)) {
                el.removeAttribute(attr.name);
              }
            } else if (name !== 'target' && name !== 'rel') {
              el.removeAttribute(attr.name);
            }
          } else if (name === 'style') {
            // Filter style properties
            const style = el.style;
            const newStyles: string[] = [];
            for (let i = 0; i < style.length; i++) {
              const prop = style[i].toLowerCase();
              if (ALLOWED_STYLES.has(prop)) {
                const val = style.getPropertyValue(prop);
                newStyles.push(`${prop}: ${val}`);
              }
            }
            if (newStyles.length > 0) {
              el.setAttribute('style', newStyles.join('; '));
            } else {
              el.removeAttribute('style');
            }
          } else {
            // Strip any unexpected attribute
            el.removeAttribute(attr.name);
          }
        }
      }
    };

    cleanNode(doc.body);
    return doc.body.innerHTML;
  } catch (err) {
    console.warn('Failed to sanitize pasted HTML:', err);
    return '';
  }
}
