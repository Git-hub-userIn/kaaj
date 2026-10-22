import { z } from 'zod';

export const VALIDATION_LIMITS = {
  MAX_PAGES_PER_ENTRY: 50,
  MAX_LAYERS_PER_PAGE: 8,
  MAX_OBJECTS_PER_PAGE: 200,
  MAX_BODY_SIZE_BYTES: 1_000_000,
  CANVAS_LOGICAL_WIDTH: 1200,
  CANVAS_LOGICAL_HEIGHT: 1600,
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
