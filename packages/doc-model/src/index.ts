import { z } from 'zod';

export const VALIDATION_LIMITS = {
  MAX_PAGES_PER_ENTRY: 50,
  MAX_LAYERS_PER_PAGE: 8,
  MAX_OBJECTS_PER_PAGE: 200,
  MAX_BODY_SIZE_BYTES: 1_000_000,
  CANVAS_LOGICAL_WIDTH: 1200,
  CANVAS_LOGICAL_HEIGHT: 1600,
  MIN_SPINE_HEIGHT_PX: 44,
  MAX_SPINE_HEIGHT_PX: 104,
  DEFAULT_PILE_SIZE: 10,
  MAX_LIGHT_ROWS_CAP: 500,
} as const;

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

export const DocumentEnvelopeSchema = z.object({
  schemaVersion: z.number().int().positive().default(1),
  pages: z.array(PageSchema).min(1).max(VALIDATION_LIMITS.MAX_PAGES_PER_ENTRY),
});

export type Transform = z.infer<typeof TransformSchema>;
export type LayerObject = z.infer<typeof LayerObjectSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type RichTextBody = z.infer<typeof RichTextBodySchema>;
export type Page = z.infer<typeof PageSchema>;
export type DocumentEnvelope = z.infer<typeof DocumentEnvelopeSchema>;

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

export const EntryStatsSchema = z.object({
  words: z.number().int().default(0),
  pages: z.number().int().default(1),
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
  schemaVersion: z.number().int().default(1),
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

/**
 * Creates a valid empty DocumentEnvelope (schemaVersion 1).
 */
export function createEmptyDocument(title = 'Untitled'): DocumentEnvelope {
  return {
    schemaVersion: 1,
    pages: [
      {
        id: `p_${crypto.randomUUID()}`,
        size: {
          width: VALIDATION_LIMITS.CANVAS_LOGICAL_WIDTH,
          height: VALIDATION_LIMITS.CANVAS_LOGICAL_HEIGHT,
        },
        background: { type: 'solid', token: 'paper' },
        body: {
          format: 'kaaj-rich-text-v1',
          content: [
            { type: 'heading', level: 1, text: title },
            { type: 'paragraph', text: '' },
          ],
        },
        layers: [],
      },
    ],
  };
}

/**
 * Pure weight function.
 * Calculates entry weight from character count, image count, and layer object count.
 */
export function calculateWeight(doc: DocumentEnvelope): number {
  let charCount = 0;
  let imageCount = 0;
  let objectCount = 0;

  for (const page of doc.pages) {
    // Traverse body blocks for characters and inline images
    for (const block of page.body.content) {
      if (block.type === 'image') {
        imageCount += 1;
      }
      if (typeof block.text === 'string') {
        charCount += block.text.length;
      }
    }

    // Traverse layers
    for (const layer of page.layers) {
      objectCount += layer.objects.length;
      for (const obj of layer.objects) {
        if (obj.type === 'image') {
          imageCount += 1;
        }
      }
    }
  }

  // Pure formula: 1 weight point per 100 characters + 10 points per image + 2 points per layer object
  const rawWeight = Math.floor(charCount / 100) + imageCount * 10 + objectCount * 2;
  return Math.max(1, rawWeight);
}

/**
 * Alias for calculateWeight per spec ("the single weight() function in doc-model").
 */
export const weight = calculateWeight;

/**
 * Pure function to calculate entry statistics: words, pages, and images.
 */
export function calculateEntryStats(doc: DocumentEnvelope): EntryStats {
  let words = 0;
  let images = 0;
  const pages = Math.max(1, doc.pages.length);

  for (const page of doc.pages) {
    for (const block of page.body.content) {
      if (block.type === 'image') {
        images += 1;
      }
      if (typeof block.text === 'string' && block.text.trim().length > 0) {
        const matches = block.text.trim().match(/\S+/g);
        if (matches) {
          words += matches.length;
        }
      }
    }
    for (const layer of page.layers) {
      for (const obj of layer.objects) {
        if (obj.type === 'image') {
          images += 1;
        }
        if (typeof obj.text === 'string' && obj.text.trim().length > 0) {
          const matches = obj.text.trim().match(/\S+/g);
          if (matches) {
            words += matches.length;
          }
        }
      }
    }
  }

  return { words, pages, images };
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
  // Linear scale up to weight 50, then clamped at maxHeight
  const progress = Math.min(1, (safeWeight - 1) / 49);
  const calculated = Math.round(minHeight + progress * (maxHeight - minHeight));
  return Math.min(maxHeight, Math.max(minHeight, calculated));
}
