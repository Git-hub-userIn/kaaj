import { z } from 'zod';
import { ENTRY_SIZE_LIMITS } from './limits.js';

export { ENTRY_SIZE_LIMITS };

export const VALIDATION_LIMITS = {
  MAX_PAGES_PER_ENTRY: 50,
  MAX_LAYERS_PER_PAGE: 8,
  MAX_OBJECTS_PER_PAGE: 200,
  MAX_BODY_SIZE_BYTES: ENTRY_SIZE_LIMITS.WARNING_BYTES,
  MAX_ENTRY_SIZE_BYTES: ENTRY_SIZE_LIMITS.MAX_BYTES,
  CANVAS_LOGICAL_WIDTH: 1200,
  CANVAS_LOGICAL_HEIGHT: 1600,
  MIN_SPINE_HEIGHT_PX: 44,
  MAX_SPINE_HEIGHT_PX: 104,
  DEFAULT_PILE_SIZE: 10,
  MAX_LIGHT_ROWS_CAP: 500,
} as const;

/* ========================================================================== */
/* V1 Schemas (Preserved for migration and backward-compatibility)             */
/* ========================================================================== */

export const TransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().default(0),
});

export const AnchorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('page'),
  }),
  z.object({
    type: z.literal('block'),
    id: z.string(),
  }),
]);

export const LayerObjectTypeSchema = z.enum([
  'image',
  'sticker',
  'text',
  'line',
  'shape',
  'tape',
]);

export const LayerObjectSchema = z.object({
  id: z.string().min(1),
  type: LayerObjectTypeSchema,
  assetId: z.string().optional(),
  text: z.string().optional(),
  transform: TransformSchema,
  anchor: AnchorSchema.default({ type: 'page' }),
  style: z.record(z.unknown()).default({}),
});

export const LayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  objects: z.array(LayerObjectSchema).max(VALIDATION_LIMITS.MAX_OBJECTS_PER_PAGE).default([]),
});

export const RichTextBodySchema = z.object({
  format: z.literal('kaaj-rich-text-v1'),
  content: z.array(z.record(z.unknown())).default([]),
});

export const PageBackgroundSchema = z.object({
  type: z.enum(['solid', 'texture']).default('solid'),
  token: z.string().default('paper'),
});

export const PageSizeSchema = z.object({
  width: z.number().default(VALIDATION_LIMITS.CANVAS_LOGICAL_WIDTH),
  height: z.number().default(VALIDATION_LIMITS.CANVAS_LOGICAL_HEIGHT),
});

export const PageSchema = z.object({
  id: z.string().min(1),
  size: PageSizeSchema.default({
    width: VALIDATION_LIMITS.CANVAS_LOGICAL_WIDTH,
    height: VALIDATION_LIMITS.CANVAS_LOGICAL_HEIGHT,
  }),
  background: PageBackgroundSchema.default({ type: 'solid', token: 'paper' }),
  body: RichTextBodySchema.default({ format: 'kaaj-rich-text-v1', content: [] }),
  layers: z.array(LayerSchema).max(VALIDATION_LIMITS.MAX_LAYERS_PER_PAGE).default([]),
});

export const DocumentEnvelopeV1Schema = z.object({
  schemaVersion: z.literal(1).default(1),
  pages: z.array(PageSchema).min(1).max(VALIDATION_LIMITS.MAX_PAGES_PER_ENTRY),
});

/* ========================================================================== */
/* V2 ProseMirror JSON Schema with Whitelisted Nodes, Marks, & Attributes      */
/* ========================================================================== */

// Marks (Whitelisted mark types with permitted attributes)
export const BoldMarkSchema = z.object({
  type: z.literal('bold'),
  attrs: z.record(z.unknown()).optional(),
});

export const ItalicMarkSchema = z.object({
  type: z.literal('italic'),
  attrs: z.record(z.unknown()).optional(),
});

export const UnderlineMarkSchema = z.object({
  type: z.literal('underline'),
  attrs: z.record(z.unknown()).optional(),
});

export const StrikeMarkSchema = z.object({
  type: z.literal('strike'),
  attrs: z.record(z.unknown()).optional(),
});

export const LinkMarkSchema = z.object({
  type: z.literal('link'),
  attrs: z.object({
    href: z.string().regex(/^(https?:\/\/|mailto:)/, 'Must be http, https, or mailto'),
    target: z.string().nullable().optional(),
    rel: z.string().nullable().optional(),
    class: z.string().nullable().optional(),
  }).passthrough(),
});

export const TextStyleMarkSchema = z.object({
  type: z.literal('textStyle'),
  attrs: z.object({
    color: z.string().nullable().optional(),
    fontFamily: z.string().nullable().optional(),
    fontSize: z.string().nullable().optional(),
  }).passthrough().optional(),
});

export const HighlightMarkSchema = z.object({
  type: z.literal('highlight'),
  attrs: z.object({
    color: z.string().nullable().optional(),
  }).passthrough().optional(),
});

export const EditorMarkSchema = z.union([
  BoldMarkSchema,
  ItalicMarkSchema,
  UnderlineMarkSchema,
  StrikeMarkSchema,
  LinkMarkSchema,
  TextStyleMarkSchema,
  HighlightMarkSchema,
]);

// Inline text node
export const EditorTextNodeSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  marks: z.array(EditorMarkSchema).optional(),
}).strict();

// Block nodes
export const EditorParagraphNodeSchema = z.object({
  type: z.literal('paragraph'),
  attrs: z.object({
    id: z.string().nullable().optional(),
    textAlign: z.enum(['left', 'center', 'right']).nullable().optional(),
  }).passthrough().optional(),
  content: z.array(EditorTextNodeSchema).optional(),
});

export const EditorHeadingNodeSchema = z.object({
  type: z.literal('heading'),
  attrs: z.object({
    id: z.string().nullable().optional(),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    textAlign: z.enum(['left', 'center', 'right']).nullable().optional(),
  }).passthrough().optional(),
  content: z.array(EditorTextNodeSchema).optional(),
});

export const EditorHorizontalRuleNodeSchema = z.object({
  type: z.literal('horizontalRule'),
  attrs: z.object({
    id: z.string().nullable().optional(),
  }).passthrough().optional(),
});

export const EditorBlockquoteNodeSchema = z.object({
  type: z.literal('blockquote'),
  attrs: z.object({
    id: z.string().nullable().optional(),
    textAlign: z.enum(['left', 'center', 'right']).nullable().optional(),
  }).passthrough().optional(),
  content: z.array(EditorParagraphNodeSchema).optional(),
});

// List nodes
export type EditorListItemNode = {
  type: 'listItem';
  attrs?: Record<string, unknown>;
  content?: Array<EditorParagraphNode | EditorBulletListNode | EditorOrderedListNode>;
};

export type EditorParagraphNode = z.infer<typeof EditorParagraphNodeSchema>;
export type EditorHeadingNode = z.infer<typeof EditorHeadingNodeSchema>;
export type EditorHorizontalRuleNode = z.infer<typeof EditorHorizontalRuleNodeSchema>;
export type EditorBlockquoteNode = z.infer<typeof EditorBlockquoteNodeSchema>;

export type EditorBulletListNode = {
  type: 'bulletList';
  attrs?: Record<string, unknown>;
  content?: EditorListItemNode[];
};

export type EditorOrderedListNode = {
  type: 'orderedList';
  attrs?: Record<string, unknown>;
  content?: EditorListItemNode[];
};

export const EditorListItemNodeSchema: z.ZodType<EditorListItemNode> = z.lazy(() =>
  z.object({
    type: z.literal('listItem'),
    attrs: z.object({
      id: z.string().nullable().optional(),
      textAlign: z.enum(['left', 'center', 'right']).nullable().optional(),
    }).passthrough().optional(),
    content: z.array(
      z.union([
        EditorParagraphNodeSchema,
        EditorBulletListNodeSchema,
        EditorOrderedListNodeSchema,
      ])
    ).optional(),
  })
);

export const EditorBulletListNodeSchema: z.ZodType<EditorBulletListNode> = z.lazy(() =>
  z.object({
    type: z.literal('bulletList'),
    attrs: z.object({
      id: z.string().nullable().optional(),
      textAlign: z.enum(['left', 'center', 'right']).nullable().optional(),
    }).passthrough().optional(),
    content: z.array(EditorListItemNodeSchema).optional(),
  })
);

export const EditorOrderedListNodeSchema: z.ZodType<EditorOrderedListNode> = z.lazy(() =>
  z.object({
    type: z.literal('orderedList'),
    attrs: z.object({
      id: z.string().nullable().optional(),
      start: z.number().int().nullable().optional(),
      type: z.string().nullable().optional(),
      textAlign: z.enum(['left', 'center', 'right']).nullable().optional(),
    }).passthrough().optional(),
    content: z.array(EditorListItemNodeSchema).optional(),
  })
);

export const EditorImageNodeSchema = z.object({
  type: z.literal('image'),
  attrs: z.object({
    id: z.string().nullable().optional(),
    assetId: z.string().min(1),
    alt: z.string().nullable().optional().default(''),
    width: z.number().min(0.1).max(1.0).optional().default(1.0),
  }).passthrough(),
});

export type EditorImageNode = z.infer<typeof EditorImageNodeSchema>;

export const TopLevelBlockSchema = z.union([
  EditorParagraphNodeSchema,
  EditorHeadingNodeSchema,
  EditorBulletListNodeSchema,
  EditorOrderedListNodeSchema,
  EditorBlockquoteNodeSchema,
  EditorHorizontalRuleNodeSchema,
  EditorImageNodeSchema,
]);

export const ProseMirrorDocSchema = z.object({
  type: z.literal('doc'),
  content: z.array(TopLevelBlockSchema),
}).strict();

export const DocumentEnvelopeV2Schema = z.object({
  schemaVersion: z.literal(2).default(2),
  doc: ProseMirrorDocSchema,
}).strict();

export const DocumentEnvelopeSchema = z.union([
  DocumentEnvelopeV2Schema,
  DocumentEnvelopeV1Schema,
]);

export type Transform = z.infer<typeof TransformSchema>;
export type LayerObject = z.infer<typeof LayerObjectSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type RichTextBody = z.infer<typeof RichTextBodySchema>;
export type Page = z.infer<typeof PageSchema>;
export type DocumentEnvelopeV1 = z.infer<typeof DocumentEnvelopeV1Schema>;
export type DocumentEnvelopeV2 = z.infer<typeof DocumentEnvelopeV2Schema>;
export type DocumentEnvelope = z.infer<typeof DocumentEnvelopeSchema>;
export type ProseMirrorDoc = z.infer<typeof ProseMirrorDocSchema>;
export type TopLevelBlock = z.infer<typeof TopLevelBlockSchema>;

/* ========================================================================== */
/* Chunked Storage Schemas and Manifest                                       */
/* ========================================================================== */

export const CHUNK_LIMITS = {
  MAX_BLOCKS: 50,
  MAX_BYTES: 64 * 1024, // 64 KB
} as const;

export const ChunkMetadataSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  blockCount: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  checksum: z.string().min(1),
  charCount: z.number().int().nonnegative().optional(),
  imageCount: z.number().int().nonnegative().optional(),
  wordCount: z.number().int().nonnegative().optional(),
});

export const EntryManifestSchema = z.object({
  entryId: z.string().min(1),
  schemaVersion: z.literal(2).default(2),
  version: z.number().int().positive(),
  totalBlocks: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  stats: z.object({
    words: z.number().int().nonnegative().default(0),
    images: z.number().int().nonnegative().default(0),
    charCount: z.number().int().nonnegative().default(0),
  }).optional(),
  chunks: z.array(ChunkMetadataSchema),
  updatedAt: z.string(),
});

export const ChunkPayloadSchema = z.object({
  chunkId: z.string().min(1),
  entryId: z.string().min(1),
  blocks: z.array(TopLevelBlockSchema),
});

export type ChunkMetadata = z.infer<typeof ChunkMetadataSchema>;
export type EntryManifest = z.infer<typeof EntryManifestSchema>;
export type ChunkPayload = z.infer<typeof ChunkPayloadSchema>;

/* ========================================================================== */
/* App Models and Schemas                                                     */
/* ========================================================================== */

export const TodoItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().max(200),
  done: z.boolean().default(false),
});

export const MonthEntryCountSchema = z.object({
  month: z.string(),
  label: z.string(),
  count: z.number().int().default(0),
});

export const CategoryStatsSchema = z.object({
  entries: z.number().int().default(0),
  words: z.number().int().default(0),
  images: z.number().int().default(0),
  createdAt: z.string(),
  lastEditedAt: z.string().nullable().optional(),
  entriesPerMonth: z.array(MonthEntryCountSchema).default([]),
});

export type TodoItem = z.infer<typeof TodoItemSchema>;
export type MonthEntryCount = z.infer<typeof MonthEntryCountSchema>;
export type CategoryStats = z.infer<typeof CategoryStatsSchema>;

export const CategorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(100),
  description: z.string().optional(),
  coverAssetId: z.string().optional(),
  sortOrder: z.number().int().default(0),
  color: z.string().optional(),
  todo: z.array(TodoItemSchema).max(12).default([]),
  version: z.number().int().default(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable().optional(),
});

export const CategoryLightRowSchema = CategorySchema.extend({
  entryCount: z.number().int().default(0),
});

export type Category = z.infer<typeof CategorySchema>;
export type CategoryLightRow = z.infer<typeof CategoryLightRowSchema>;

export const SpineTextureSchema = z.enum([
  'cloth',
  'leather',
  'linen',
  'marbled',
  'kraft',
  'worn',
]);

export const SpineFontSchema = z.enum([
  'newsreader',
  'kalam',
  'special-elite',
  'oswald',
  'playfair-display',
]);

export const SpineFinishSchema = z.enum([
  'gold-foil',
  'silver-foil',
  'cream-foil',
  'white-foil',
  'dark-ink',
  'brown-ink',
  'white-ink',
  'black-ink',
]);

export const SpineBandsSchema = z.enum([
  'none',
  'two',
  'three',
]);

export const SpineStyleSchema = z.object({
  texture: SpineTextureSchema.default('cloth'),
  color: z.string().default('#8B3A2B'),
  font: SpineFontSchema.default('newsreader'),
  finish: SpineFinishSchema.default('gold-foil'),
  bands: SpineBandsSchema.default('two'),
});

// Note: pages removed from stats per task specification
export const EntryStatsSchema = z.object({
  words: z.number().int().default(0),
  images: z.number().int().default(0),
});

export type SpineStyle = z.infer<typeof SpineStyleSchema>;
export type SpineTexture = z.infer<typeof SpineTextureSchema>;
export type SpineFont = z.infer<typeof SpineFontSchema>;
export type SpineFinish = z.infer<typeof SpineFinishSchema>;
export type SpineBands = z.infer<typeof SpineBandsSchema>;
export type EntryStats = z.infer<typeof EntryStatsSchema>;

export const EntrySchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  title: z.string().min(1).max(200),
  doc: DocumentEnvelopeSchema,
  schemaVersion: z.number().int().default(2),
  version: z.number().int().default(1),
  weight: z.number().int().default(1),
  sortOrder: z.number().int().default(0),
  color: z.string().nullable().optional(),
  pinned: z.boolean().default(false),
  spine: SpineStyleSchema.nullable().optional(),
  stats: EntryStatsSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
});

export const EntryLightRowSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  title: z.string().min(1).max(200),
  weight: z.number().int().default(1),
  sortOrder: z.number().int().default(0),
  color: z.string().nullable().optional(),
  pinned: z.boolean().default(false),
  spine: SpineStyleSchema.nullable().optional(),
  stats: EntryStatsSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
});

export const CreateEntrySchema = z.object({
  categoryId: z.string().min(1),
  title: z.string().max(200).optional(),
  color: z.string().optional(),
  pinned: z.boolean().optional(),
  spine: SpineStyleSchema.optional(),
  doc: DocumentEnvelopeSchema.optional(),
});

export const UpdateEntrySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  categoryId: z.string().min(1).optional(),
  color: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  spine: SpineStyleSchema.nullable().optional(),
});

export type Entry = z.infer<typeof EntrySchema>;
export type EntryLightRow = z.infer<typeof EntryLightRowSchema>;
export type CreateEntryInput = z.infer<typeof CreateEntrySchema>;
export type UpdateEntryInput = z.infer<typeof UpdateEntrySchema>;

/* ========================================================================== */
/* Document Construction, Migration, Weight & Stats Calculation               */
/* ========================================================================== */

/**
 * Creates a valid empty DocumentEnvelope (schemaVersion 2).
 * Empty entry has one empty paragraph.
 */
export function createEmptyDocument(_title?: string): DocumentEnvelopeV2 {
  const blockId = `b_${crypto.randomUUID()}`;
  return {
    schemaVersion: 2,
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: blockId },
          content: [],
        },
      ],
    },
  };
}

export interface MigrationResult {
  doc: DocumentEnvelopeV2;
  discardedLayerCount: number;
}

/**
 * Pure migration function from version 1 (pages and layers) to version 2 (ProseMirror JSON).
 * Converts body content to top-level blocks and counts discarded layers.
 * Does not crash on old or malformed data.
 */
export function migrateDocumentToV2(input: unknown): MigrationResult {
  if (!input || typeof input !== 'object') {
    return { doc: createEmptyDocument(), discardedLayerCount: 0 };
  }

  const anyDoc = input as any;

  // Already v2
  if (anyDoc.schemaVersion === 2 && anyDoc.doc && anyDoc.doc.type === 'doc') {
    // Ensure all top-level blocks have an id attribute
    const content = Array.isArray(anyDoc.doc.content) ? anyDoc.doc.content : [];
    const normalizedBlocks = content.map((block: any) => {
      if (!block || typeof block !== 'object') return block;
      if (!block.attrs?.id) {
        return {
          ...block,
          attrs: { ...(block.attrs || {}), id: `b_${crypto.randomUUID()}` },
        };
      }
      return block;
    });

    const parsed = DocumentEnvelopeV2Schema.safeParse({
      schemaVersion: 2,
      doc: {
        type: 'doc',
        content: normalizedBlocks.length > 0 ? normalizedBlocks : [{ type: 'paragraph', attrs: { id: `b_${crypto.randomUUID()}` }, content: [] }],
      },
    });

    if (parsed.success) {
      return { doc: parsed.data, discardedLayerCount: 0 };
    }
  }

  // Migrate v1
  let discardedLayerCount = 0;
  const topLevelBlocks: TopLevelBlock[] = [];

  const pages = Array.isArray(anyDoc.pages) ? anyDoc.pages : [];
  for (const page of pages) {
    if (Array.isArray(page.layers)) {
      discardedLayerCount += page.layers.length;
    }

    const bodyBlocks = page.body?.content;
    if (Array.isArray(bodyBlocks)) {
      for (const block of bodyBlocks) {
        if (!block || typeof block !== 'object') continue;
        const blockId = `b_${crypto.randomUUID()}`;

        if (block.type === 'heading') {
          const rawLevel = Number(block.level) || 1;
          const level: 1 | 2 | 3 = rawLevel === 2 ? 2 : rawLevel === 3 ? 3 : 1;
          const text = typeof block.text === 'string' ? block.text : '';
          topLevelBlocks.push({
            type: 'heading',
            attrs: { id: blockId, level },
            content: text ? [{ type: 'text', text }] : [],
          });
        } else if (block.type === 'paragraph') {
          const text = typeof block.text === 'string' ? block.text : '';
          topLevelBlocks.push({
            type: 'paragraph',
            attrs: { id: blockId },
            content: text ? [{ type: 'text', text }] : [],
          });
        } else if (block.type === 'bulletList' || block.type === 'orderedList' || block.type === 'blockquote' || block.type === 'horizontalRule') {
          // Keep structure, ensure id
          topLevelBlocks.push({
            ...block,
            attrs: { ...(block.attrs || {}), id: blockId },
          });
        }
      }
    }
  }

  if (topLevelBlocks.length === 0) {
    topLevelBlocks.push({
      type: 'paragraph',
      attrs: { id: `b_${crypto.randomUUID()}` },
      content: [],
    });
  }

  const v2Doc: DocumentEnvelopeV2 = {
    schemaVersion: 2,
    doc: {
      type: 'doc',
      content: topLevelBlocks,
    },
  };

  return {
    doc: v2Doc,
    discardedLayerCount,
  };
}

/**
 * Pure weight function.
 * Calculates entry weight from characters in the document.
 * 1 weight point per 100 characters. Minimum weight is 1.
 */
export function calculateWeight(envelope: unknown): number {
  if (!envelope || typeof envelope !== 'object') return 1;
  const anyDoc = envelope as any;

  // Manifest support: calculate directly from manifest without loading full doc
  if (Array.isArray(anyDoc.chunks)) {
    let charCount = anyDoc.stats?.charCount ?? 0;
    let imageCount = anyDoc.stats?.images ?? 0;
    if (charCount === 0 && imageCount === 0) {
      for (const chk of anyDoc.chunks) {
        charCount += chk.charCount ?? (chk.bytes ? Math.floor(chk.bytes / 2) : 0);
        imageCount += chk.imageCount ?? 0;
      }
    }
    return Math.max(1, Math.floor(charCount / 100) + imageCount * 10);
  }

  // Schema version 2
  if (anyDoc.schemaVersion === 2 && anyDoc.doc) {
    let charCount = 0;
    let imageCount = 0;
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'image') {
        imageCount += 1;
      }
      if (node.type === 'text' && typeof node.text === 'string') {
        charCount += node.text.length;
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          walk(child);
        }
      }
    };
    walk(anyDoc.doc);
    return Math.max(1, Math.floor(charCount / 100) + imageCount * 10);
  }

  // Fallback for v1 pages
  if (Array.isArray(anyDoc.pages)) {
    let charCount = 0;
    let imageCount = 0;
    let objectCount = 0;

    for (const page of anyDoc.pages) {
      if (Array.isArray(page.body?.content)) {
        for (const block of page.body.content) {
          if (block.type === 'image') imageCount += 1;
          if (typeof block.text === 'string') charCount += block.text.length;
        }
      }
      if (Array.isArray(page.layers)) {
        objectCount += page.layers.length;
        for (const layer of page.layers) {
          if (Array.isArray(layer.objects)) {
            objectCount += layer.objects.length;
            for (const obj of layer.objects) {
              if (obj.type === 'image') imageCount += 1;
            }
          }
        }
      }
    }
    const rawWeight = Math.floor(charCount / 100) + imageCount * 10 + objectCount * 2;
    return Math.max(1, rawWeight);
  }

  return 1;
}

export const weight = calculateWeight;

/**
 * Pure function to calculate entry statistics: words and images.
 * (pages is removed per task spec).
 */
export function calculateEntryStats(envelope: unknown): EntryStats {
  if (!envelope || typeof envelope !== 'object') return { words: 0, images: 0 };
  const anyDoc = envelope as any;

  if (anyDoc.schemaVersion === 2 && anyDoc.doc) {
    let words = 0;
    let images = 0;
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'image') {
        images += 1;
      }
      if (node.type === 'text' && typeof node.text === 'string' && node.text.trim().length > 0) {
        const matches = node.text.trim().match(/\S+/g);
        if (matches) words += matches.length;
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          walk(child);
        }
      }
    };
    walk(anyDoc.doc);
    return { words, images };
  }

  // Fallback for v1 pages
  if (Array.isArray(anyDoc.pages)) {
    let words = 0;
    let images = 0;
    for (const page of anyDoc.pages) {
      if (Array.isArray(page.body?.content)) {
        for (const block of page.body.content) {
          if (block.type === 'image') images += 1;
          if (typeof block.text === 'string' && block.text.trim().length > 0) {
            const matches = block.text.trim().match(/\S+/g);
            if (matches) words += matches.length;
          }
        }
      }
    }
    return { words, images };
  }

  return { words: 0, images: 0 };
}

/**
 * Clamps entry weight into book spine height in pixels.
 * Clamped strictly between minHeight (default 44px) and maxHeight (default 104px).
 */
export function calculateSpineHeight(
  entryWeight: number,
  minHeight = VALIDATION_LIMITS.MIN_SPINE_HEIGHT_PX,
  maxHeight = VALIDATION_LIMITS.MAX_SPINE_HEIGHT_PX
): number {
  const safeWeight = Math.max(1, entryWeight);
  const progress = Math.min(1, (safeWeight - 1) / 49);
  const calculated = Math.round(minHeight + progress * (maxHeight - minHeight));
  return Math.min(maxHeight, Math.max(minHeight, calculated));
}

/**
 * Normalizes ProseMirror block attributes for deterministic hashing.
 * Strips default values (e.g. textAlign: 'left') and null/undefined values.
 */
export function normalizeBlockForHash(block: any): any {
  if (Array.isArray(block)) return block.map(normalizeBlockForHash);
  if (block && typeof block === 'object') {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(block)) {
      if (v === null || v === undefined) continue;
      if (k === 'attrs' && typeof v === 'object') {
        const cleanAttrs: Record<string, any> = {};
        for (const [ak, av] of Object.entries(v as any)) {
          if (av === null || av === undefined) continue;
          if (ak === 'textAlign' && av === 'left') continue;
          cleanAttrs[ak] = av;
        }
        if (Object.keys(cleanAttrs).length > 0) {
          res.attrs = cleanAttrs;
        }
      } else {
        res[k] = normalizeBlockForHash(v);
      }
    }
    return res;
  }
  return block;
}

/**
 * Fast synchronous content hashing for chunk checksums.
 * Uses 64-bit FNV-1a variant formatted as "sha256-<hex>".
 * Pure JS, portable across Node, Bun, and browser.
 */
export function computeContentHash(content: string | object): string {
  const str = typeof content === 'string'
    ? content
    : JSON.stringify(normalizeBlockForHash(content));
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hashHex = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  return `sha256-${hashHex.padStart(16, '0')}`;
}

/**
 * Splits top-level ProseMirror blocks into chunks according to block count (50) and byte size (64 KB).
 * Retains stable chunk IDs when existing chunks match.
 */
export function splitBlocksIntoChunks(
  blocks: TopLevelBlock[],
  options?: {
    existingChunks?: ChunkMetadata[];
    entryId?: string;
    version?: number;
    maxBlocks?: number;
    maxBytes?: number;
  }
): { manifest: EntryManifest; chunks: ChunkPayload[] } {
  const maxBlocks = options?.maxBlocks ?? CHUNK_LIMITS.MAX_BLOCKS;
  const maxBytes = options?.maxBytes ?? CHUNK_LIMITS.MAX_BYTES;
  const entryId = options?.entryId ?? 'entry_temp';
  const version = options?.version ?? 1;
  const existingChunks = options?.existingChunks ?? [];

  const safeBlocks: TopLevelBlock[] = blocks.length > 0 ? blocks : [
    { type: 'paragraph', attrs: { id: 'blk_initial' }, content: [] }
  ];

  const chunkGroups: TopLevelBlock[][] = [];
  let currentGroup: TopLevelBlock[] = [];
  let currentBytes = 2; // "[]"

  for (const block of safeBlocks) {
    const blockJson = JSON.stringify(block);
    const blockBytes = typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(blockJson).length
      : blockJson.length;

    const wouldExceedBlocks = currentGroup.length >= maxBlocks;
    const wouldExceedBytes = currentGroup.length > 0 && (currentBytes + blockBytes + 1 > maxBytes);

    if (wouldExceedBlocks || wouldExceedBytes) {
      chunkGroups.push(currentGroup);
      currentGroup = [block];
      currentBytes = 2 + blockBytes;
    } else {
      currentGroup.push(block);
      currentBytes += blockBytes + 1;
    }
  }

  if (currentGroup.length > 0) {
    chunkGroups.push(currentGroup);
  }

  let totalWords = 0;
  let totalImages = 0;
  let totalChars = 0;

  const chunks: ChunkPayload[] = [];
  const manifestChunks: ChunkMetadata[] = [];

  chunkGroups.forEach((group, index) => {
    const stableId = existingChunks[index]?.id || `chk_${String(index + 1).padStart(2, '0')}`;
    const serialized = JSON.stringify(group);
    const checksum = computeContentHash(group);
    const byteSize = typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(serialized).length
      : serialized.length;

    let chunkChars = 0;
    let chunkImages = 0;
    let chunkWords = 0;

    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'image') chunkImages += 1;
      if (node.type === 'text' && typeof node.text === 'string') {
        chunkChars += node.text.length;
        const matches = node.text.trim().match(/\S+/g);
        if (matches) chunkWords += matches.length;
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content) walk(child);
      }
    };
    for (const b of group) walk(b);

    totalWords += chunkWords;
    totalImages += chunkImages;
    totalChars += chunkChars;

    manifestChunks.push({
      id: stableId,
      order: index,
      blockCount: group.length,
      bytes: byteSize,
      checksum,
      charCount: chunkChars,
      imageCount: chunkImages,
      wordCount: chunkWords,
    });

    chunks.push({
      chunkId: stableId,
      entryId,
      blocks: group,
    });
  });

  const manifest: EntryManifest = {
    entryId,
    schemaVersion: 2,
    version,
    totalBlocks: safeBlocks.length,
    chunkCount: manifestChunks.length,
    stats: {
      words: totalWords,
      images: totalImages,
      charCount: totalChars,
    },
    chunks: manifestChunks,
    updatedAt: new Date().toISOString(),
  };

  return { manifest, chunks };
}

/**
 * Reassembles a full DocumentEnvelopeV2 from ordered chunk block arrays.
 */
export function reassembleDocFromChunks(
  chunks: Array<{ blocks: TopLevelBlock[] }>
): DocumentEnvelopeV2 {
  const allBlocks: TopLevelBlock[] = [];
  for (const chunk of chunks) {
    if (Array.isArray(chunk.blocks)) {
      allBlocks.push(...chunk.blocks);
    }
  }
  return {
    schemaVersion: 2,
    doc: {
      type: 'doc',
      content: allBlocks,
    },
  };
}

/**
 * Canonical JSON serialization with deterministic sorted keys.
 * Used for strict document comparison during migration.
 */
export function canonicalDocJson(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return JSON.stringify(doc);
  const sortKeys = (obj: any): any => {
    if (Array.isArray(obj)) return obj.map(sortKeys);
    if (obj !== null && typeof obj === 'object') {
      const sorted: Record<string, any> = {};
      for (const key of Object.keys(obj).sort()) {
        sorted[key] = sortKeys(obj[key]);
      }
      return sorted;
    }
    return obj;
  };
  return JSON.stringify(sortKeys(doc));
}
