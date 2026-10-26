import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type {
  Category,
  CategoryLightRow,
  DocumentEnvelope,
  Entry,
  EntryLightRow,
  SpineStyle,
  EntryStats,
  CategoryStats,
  MonthEntryCount,
  TodoItem,
} from '@kaaj/doc-model';
import {
  calculateWeight,
  calculateEntryStats,
  createEmptyDocument,
  migrateDocumentToV2,
  splitBlocksIntoChunks,
  reassembleDocFromChunks,
  canonicalDocJson,
  computeContentHash,
  type EntryManifest,
  type ChunkPayload,
  type ChunkMetadata,
} from '@kaaj/doc-model';
import type { DocumentEnvelopeV2, TopLevelBlock } from '@kaaj/doc-model';
import { SEED_COVERS_MANIFEST } from '@kaaj/design';
import type { LocalDiskAssetStore } from '../stores/asset-store.js';
import { migrateEntriesToChunks, type MigrationResult } from './migration-service.js';

export interface EntryRecord {
  id: string;
  categoryId: string;
  title: string;
  sortOrder: number;
  color?: string | null;
  pinned: boolean;
  spine?: SpineStyle | null;
  stats?: EntryStats;
  weight: number;
  version: number;
  doc: DocumentEnvelope;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  lastOpenedAt?: string | null;
}

interface SeedEntrySpec {
  title: string;
  paragraphs: string[];
  imageCount?: number;
  pageCount?: number;
  color?: string;
  pinned?: boolean;
  dateOffsetDays?: number;
  spine?: SpineStyle;
}

interface SeedCategorySpec {
  key: string;
  title: string;
  description: string;
  color: string;
  sortOrder: number;
  entries: SeedEntrySpec[];
}

const IDEAS_TITLES_AND_DESCS: Array<{ title: string; text: string; pages?: number; images?: number; color: string; spine?: SpineStyle; pinned?: boolean }> = [
  {
    title: 'Field Manifesto for Slow Software',
    text: 'Software should age like paper and leather. It should reward contemplation rather than anxious vigilance. Eliminate infinite feeds, notification badges, and aggressive engagement metrics. Build tools that feel like physical objects on a sturdy oak table.',
    pages: 3,
    images: 2,
    color: 'terracotta',
    pinned: true,
    spine: { texture: 'cloth', color: '#8c3a1e', font: 'newsreader', finish: 'gold-foil', bands: 'three' },
  },
  {
    title: 'Handmade Visual Archive Concept',
    text: 'A personal archive where pages have weight, thickness, and tactile friction. Digital tools inspired by zine culture, Japanese stationery, and early bookbinding guilds.',
    pages: 2,
    images: 1,
    color: 'moss',
    pinned: true,
    spine: { texture: 'leather', color: '#344c39', font: 'playfair-display', finish: 'gold-foil', bands: 'two' },
  },
  {
    title: 'Paper Texture Generation via WebGL',
    text: 'Procedural fiber distribution, rag paper grain, deckle edges, and slight surface height variation simulated with bump mapping in fragment shaders.',
    pages: 1,
    images: 1,
    color: 'slate',
    spine: { texture: 'worn', color: '#2e414c', font: 'special-elite', finish: 'silver-foil', bands: 'two' },
  },
  {
    title: 'The Epistemology of Personal Scrapbooks',
    text: 'Collecting fragments is not hoarding; it is an act of sense-making. The juxtaposition of a train ticket next to a pressed fern creates meaning that linear narrative cannot convey.',
    pages: 4,
    images: 3,
    color: 'amber',
    spine: { texture: 'linen', color: '#7a4813', font: 'newsreader', finish: 'gold-foil', bands: 'none' },
  },
  {
    title: 'Tactile Interfaces for Touchscreens',
    text: 'Haptic feedback micro-pulses when turning digital parchment pages. Auditory cues sampled from dry linen paper and bone folding knives.',
    pages: 2,
    images: 0,
    color: 'indigo',
    spine: { texture: 'cloth', color: '#263449', font: 'oswald', finish: 'silver-foil', bands: 'two' },
  },
  {
    title: 'Zine Culture and Indie Web Protocols',
    text: 'Reclaiming personal agency on the internet through small-scale publishing, federated feeds, and hand-crafted HTML documents.',
    pages: 1,
    images: 2,
    color: 'linen',
    spine: { texture: 'kraft', color: '#ede6d8', font: 'special-elite', finish: 'black-ink', bands: 'none' },
  },
  {
    title: 'Typography of 19th Century Ledgers',
    text: 'Study of iron-gall ink penmanship, red ledger ruling lines, hand-stamped pagination, and marbled endpapers in apothecary registers.',
    pages: 3,
    images: 2,
    color: 'charcoal',
    spine: { texture: 'leather', color: '#2c2825', font: 'newsreader', finish: 'gold-foil', bands: 'three' },
  },
  {
    title: 'A Taxonomy of Marginalia and Scraps',
    text: 'Types of annotations: corrections, exclamation marks, question loops, cross-references, and small doodles drawn while waiting for rain to pass.',
    pages: 2,
    images: 1,
    color: 'clay',
    spine: { texture: 'worn', color: '#9e563a', font: 'kalam', finish: 'white-ink', bands: 'two' },
  },
  {
    title: 'Offline-First Local Storage Invariants',
    text: 'Every mutation must append to an immutable local journal before network dispatch. Sync conflicts resolved deterministically via CRDTs.',
    pages: 2,
    images: 0,
    color: 'slate',
    spine: { texture: 'cloth', color: '#2e414c', font: 'oswald', finish: 'silver-foil', bands: 'two' },
  },
  {
    title: 'Color Harmonies in Natural Pigments',
    text: 'Raw sienna, burnt umber, lapis lazuli, malachite green, and madder root red. The organic subtlety of mineral watercolours on cotton rag.',
    pages: 3,
    images: 3,
    color: 'plum',
    spine: { texture: 'marbled', color: '#4e2d3f', font: 'playfair-display', finish: 'gold-foil', bands: 'two' },
  },
  {
    title: 'Drafting Isometric Floorplans by Hand',
    text: '30-degree grid lines, mechanical 2H pencils, adjustable triangles, and erasing shields. The rhythm of constructing three dimensions on two.',
    pages: 1,
    images: 1,
    color: 'terracotta',
  },
  {
    title: 'The Lost Art of Commonplace Books',
    text: 'From Erasmus and John Locke to Virginia Woolf: keeping an index of citations, philosophical excerpts, and daily observations.',
    pages: 2,
    images: 0,
    color: 'moss',
  },
  {
    title: 'Wax Seals and Thread Stitch Bindings',
    text: 'Coptic stitch across exposed spine signatures. Flexible opening that lies perfectly flat on reading desks without cracking.',
    pages: 2,
    images: 2,
    color: 'amber',
  },
  {
    title: 'Japanese Stationery Tools & Ink Stones',
    text: 'Grinding sumi ink sticks against wet slate. The meditative preparation before the first brush stroke touches the mulberry washi.',
    pages: 1,
    images: 1,
    color: 'charcoal',
  },
  {
    title: 'Acoustic Ecology and Sound Landscapes',
    text: 'Recording dawn choruses in cedar groves. Sound pressure variations across seasonal migrations and water runoff channels.',
    pages: 3,
    images: 0,
    color: 'indigo',
  },
  {
    title: 'Preserving Digital Artifacts Across Decades',
    text: 'File format decay, proprietary lock-in, and the virtue of plain text documents paired with portable vector graphics.',
    pages: 2,
    images: 0,
    color: 'paper',
  },
  {
    title: 'The Geometry of Open Layouts',
    text: 'Asymmetric grid systems inspired by Jan Tschichold and Swiss poster typography. Balancing whitespace with dense narrative anchors.',
    pages: 2,
    images: 1,
    color: 'linen',
  },
  {
    title: 'Book Spine Embossing Techniques',
    text: 'Blind stamping with heated brass dies to press title letterforms into calico cloth, followed by gold leaf foil application.',
    pages: 1,
    images: 1,
    color: 'clay',
  },
  {
    title: 'Architectural Drafting Principles',
    text: 'Line weight hierarchy: profile lines at 0.7mm, contour lines at 0.5mm, dimension lines at 0.25mm. Clarity through discipline.',
    pages: 2,
    images: 1,
    color: 'slate',
  },
  {
    title: 'Designing for Serendipitous Retrieval',
    text: 'Flipping through physical albums allows the eye to catch unexpected connections. How can digital interfaces preserve peripheral vision?',
    pages: 2,
    images: 0,
    color: 'moss',
  },
  {
    title: 'Herbarium Mounting Protocols',
    text: 'Archival glue drops on stems, linen gummed tape across petiole bases, typed species identification labels on lower right quadrant.',
    pages: 2,
    images: 2,
    color: 'moss',
  },
  {
    title: 'Night Studies in Nocturnal Flora',
    text: 'Moonflowers and evening primrose opening under twilight. Scent dissipation patterns guided by moth pollination vectors.',
    pages: 1,
    images: 1,
    color: 'indigo',
  },
  {
    title: 'Cabinet of Curiosities Layout',
    text: 'Glass specimen jars, brass drawer pulls, velvet display linings, and partitioned cedar trays for mineral crystals.',
    pages: 3,
    images: 2,
    color: 'amber',
  },
  {
    title: 'The Architecture of Japanese Teahouses',
    text: 'Shoji screens filtering northern daylight, cedar rafters left unvarnished, and tatami floor mat proportions defining movement.',
    pages: 2,
    images: 1,
    color: 'linen',
  },
  {
    title: 'Handmade Marbled Endpapers Workshop',
    text: 'Carrageenan moss bath sizing, ox gall dispersant, comb patterns, and single-motion paper lifting onto drying racks.',
    pages: 2,
    images: 2,
    color: 'plum',
  },
  {
    title: 'The Geometry of Wind Turbines',
    text: 'Aerodynamic blade twist, composite carbon spars, and silent rotation curves cutting through coastal gusts.',
    pages: 1,
    images: 0,
    color: 'slate',
  },
  {
    title: 'Fountain Pen Nib Grinds and Ink Flow',
    text: 'Architect grind versus cursive italic. Surface tension variations across dye-based versus pigment-based fountain pen inks.',
    pages: 2,
    images: 1,
    color: 'terracotta',
  },
  {
    title: 'Ancient Cartography of Northern Coasts',
    text: 'Sea monster vignettes in uncharted waters, rhumb lines radiating from compass roses, and hand-tinted coastlines.',
    pages: 3,
    images: 2,
    color: 'charcoal',
  },
  {
    title: 'Principles of Wood Joinery',
    text: 'Through mortise and tenon, stopped sliding dovetails, and drawbore pins tightened without synthetic adhesives.',
    pages: 2,
    images: 1,
    color: 'clay',
  },
  {
    title: 'Observations on Mountain Fog Formations',
    text: 'Orographic lift carrying moist maritime air over pine ridges, condensing into dense silver cloud blankets before noon.',
    pages: 1,
    images: 1,
    color: 'paper',
  },
  {
    title: 'Microbial Ecology of Forest Soil',
    text: 'Mycelial networks threading through decaying hemlock needles, redistributing phosphorus and carbon across tree canopies.',
    pages: 2,
    images: 1,
    color: 'moss',
  },
  {
    title: 'The Aesthetics of Industrial Ruins',
    text: 'Oxidized iron trusses overtaken by creeping ivy. Concrete silos reflecting low golden hour sunlight across empty railway sidings.',
    pages: 2,
    images: 2,
    color: 'slate',
  },
  {
    title: 'Typographic Kerning and Optical Spacing',
    text: 'The negative space between uppercase T and lowercase o. Rhythm, optical density, and balance across continuous body prose.',
    pages: 1,
    images: 0,
    color: 'charcoal',
  },
  {
    title: 'Hand-Cut Linoleum Printing Blocks',
    text: 'V-gouges and U-gouges carving into battleship linoleum. Thick oil-based block printing ink rolled with hard brayers.',
    pages: 2,
    images: 2,
    color: 'terracotta',
  },
  {
    title: 'Sound Design with Analog Modular Synthesizers',
    text: 'Voltage-controlled oscillators tuned to fifths, resonant low-pass ladder filters, and slow triangular low-frequency modulation.',
    pages: 2,
    images: 1,
    color: 'indigo',
  },
  {
    title: 'Studies in Old Brick Masonry',
    text: 'Flemish bond versus English bond. Lime mortar flexibility permitting centuries of seasonal thermal expansion without cracking.',
    pages: 2,
    images: 1,
    color: 'clay',
  },
  {
    title: 'Field Notes from High Alpine Lakes',
    text: 'Granite cirques cupping turquoise meltwater. Dwarf willow shrubs clinging to scree slopes above timberline.',
    pages: 3,
    images: 2,
    color: 'amber',
  },
  {
    title: 'Solar Geometry and Sundial Calculations',
    text: 'Gnomon angle equal to local latitude, equation of time correction curves, and hour lines etched into slate slabs.',
    pages: 1,
    images: 0,
    color: 'linen',
  },
  {
    title: 'Fermentation Science and Micro-Koji Cultures',
    text: 'Aspergillus oryzae inoculated onto steamed barley. Temperature curves maintained at 36 degrees for forty-eight hours.',
    pages: 2,
    images: 1,
    color: 'amber',
  },
  {
    title: 'The Philosophy of Solitary Walking',
    text: 'Rousseau, Thoreau, and Basho: walking as an engine for unhurried thought, rhythmically synchronizing breath and observation.',
    pages: 3,
    images: 0,
    color: 'moss',
  },
  {
    title: 'Preserving Botanical Pressings in Archival Vellum',
    text: 'Pure vellum sleeves protecting fragile delicate petals from ambient humidity and ultraviolet degradation.',
    pages: 1,
    images: 1,
    color: 'paper',
  },
  {
    title: 'Ceramic Glazes and Wood-Fired Kiln Atmospheres',
    text: 'Ash deposits melting into shino glazes during three-day anagama firings, creating natural crackle textures and carbon trap blush.',
    pages: 2,
    images: 2,
    color: 'clay',
  },
  {
    title: 'Bicycle Frame Geometry and Lugged Steel Tubing',
    text: 'Reynolds 531 butted steel tubes joined with investment-cast lugs and silver brazing wire at 650 degrees Celsius.',
    pages: 2,
    images: 1,
    color: 'slate',
  },
  {
    title: 'The Craft of Custom Leather Watch Straps',
    text: 'Saddle stitching with waxed French linen thread, burnished edges with gum tragacanth, and natural veg-tan patina development.',
    pages: 1,
    images: 1,
    color: 'amber',
  },
  {
    title: 'Astronomy from Remote Desert Plateaus',
    text: 'Zodiacal light visible before dawn, pin-sharp stars down to tenth magnitude, and long-exposure tracking of the Andromeda galaxy.',
    pages: 3,
    images: 2,
    color: 'indigo',
  },
  {
    title: 'Traditional Wool Weaving and Loom Mechanics',
    text: 'Four-shaft floor loom setup, warping mill calculations, and shuttle rhythm weaving herringbone twill patterns.',
    pages: 2,
    images: 1,
    color: 'linen',
  },
  {
    title: 'Old Bookstore Cataloguing Methods',
    text: 'Card catalog drawers arranged by subject, author surname, and edition rarity. The smell of cedar cabinets and decaying pulp.',
    pages: 2,
    images: 0,
    color: 'charcoal',
  },
  {
    title: 'The Chemistry of Watercolors and Gum Arabic',
    text: 'Kordofan gum arabic binder, vegetable glycerin plasticizer, and natural honey adding moisture retention to pan colors.',
    pages: 2,
    images: 2,
    color: 'plum',
  },
  {
    title: 'Coastal Lighthouses and Fog Signal Protocols',
    text: 'Fresnel lens rotation clockworks driven by descending iron weights. Compressed air diaphone blasts echoing through sea haze.',
    pages: 2,
    images: 1,
    color: 'slate',
  },
  {
    title: 'A Study in Hand-Carved Wooden Spoons',
    text: 'Green cherry wood split with a froe, carved with a straight sloyd knife and curved hook knife, finished with raw walnut oil.',
    pages: 1,
    images: 1,
    color: 'clay',
  },
  {
    title: 'Wild Mushroom Foraging in Mixed Conifer Woods',
    text: 'Chanterelles nestled under spruce duff, king boletes pushing through pine needles, and spore print records on black paper.',
    pages: 2,
    images: 2,
    color: 'moss',
  },
  {
    title: 'Tasting Notes on Single-Origin Darjeeling First Flush',
    text: 'Muscatel notes, fresh green almond finish, and bright pale amber liquor steeped for three minutes at 85 degrees Celsius.',
    pages: 1,
    images: 0,
    color: 'amber',
  },
  {
    title: 'The Poetry of Railway Timetables',
    text: 'Connecting spurs, seasonal sleeper cars, single-track passing loops, and whistle stops marked only with a lowercase cross.',
    pages: 2,
    images: 0,
    color: 'charcoal',
  },
  {
    title: 'Restoring Vintage Mechanical Wristwatches',
    text: 'Pegwood cleaning balance jewels, applying micro-droplets of Moebius synthetic oil with fine needle oilers.',
    pages: 2,
    images: 2,
    color: 'indigo',
  },
  {
    title: 'The Morphology of Coastal Seaweeds',
    text: 'Bladder wrack air vesicles, kelp holdfast anchors adhering to granite boulders, and pressed specimens on watercolour cards.',
    pages: 1,
    images: 1,
    color: 'moss',
  },
  {
    title: 'Dry Stone Wall Construction Techniques',
    text: 'Hearting stones packed tightly between batter faces, through-stones spanning the wall thickness for lateral structural tie.',
    pages: 2,
    images: 1,
    color: 'slate',
  },
  {
    title: 'Calligraphy of Gothic Blackletter Textura',
    text: 'Broad edge dip pen held at forty-five degrees, consistent stroke spacing equal to nib width, and vermilion capital flourishes.',
    pages: 2,
    images: 2,
    color: 'terracotta',
  },
  {
    title: 'Early Glass Plate Negative Photography',
    text: 'Collodion poured onto clean glass plates, sensitized in silver nitrate bath, exposed wet, and developed under amber lanterns.',
    pages: 3,
    images: 2,
    color: 'charcoal',
  },
  {
    title: 'Designing Quiet Spaces in Modern Cities',
    text: 'Acoustic baffle courtyard walls, trickling stone fountains masking traffic roar, and deciduous leaf shade cooling brick walkways.',
    pages: 2,
    images: 1,
    color: 'linen',
  },
  {
    title: 'An Inventory of Personal Writing Desks',
    text: 'Slanted oak lap desks, brass-cornered campaign boxes, rolled stationery compartments, and secret spring-loaded document drawers.',
    pages: 2,
    images: 1,
    color: 'amber',
  },
];

// Generate 60 entries for ideas
const SEED_IDEAS_ENTRIES: SeedEntrySpec[] = IDEAS_TITLES_AND_DESCS.map((item, idx) => {
  // Distribute over 180 days (6 months)
  const offsetDays = Math.round((idx / 60) * 175);
  return {
    title: item.title,
    paragraphs: [item.text, 'Additional field observations and contemplative notes collected during quiet morning sessions at the study desk.'],
    pageCount: item.pages || 1,
    imageCount: item.images || 0,
    color: item.color,
    pinned: item.pinned || false,
    dateOffsetDays: offsetDays,
    spine: item.spine,
  };
});

const SEED_CATEGORIES_DATA: SeedCategorySpec[] = [
  {
    key: 'travel',
    title: 'Travel',
    description: 'Roads taken, train journeys, and field notes from afar',
    color: 'terracotta',
    sortOrder: 0,
    entries: [
      {
        title: 'Kyoto in Early Spring',
        paragraphs: [
          'The morning mist hangs low over the Kamo River. Stone lanterns line the perimeter of the shrine grounds, each wrapped in dry moss that smells of damp earth and incense.',
          'Walked four miles past the wooden merchant houses of Gion before the streets woke up. An elderly woman was sweeping cherry blossoms off a cobblestone threshold with a bamboo broom.',
        ],
        imageCount: 1,
        color: 'moss',
        dateOffsetDays: 30,
      },
      {
        title: 'Rajasthan Desert Trail',
        paragraphs: [
          'Ochre dunes stretch out past the desert fortress. The wind hums a low frequency against the sandstone ramparts, carrying the scent of cumin, dry woodsmoke, and heat.',
          'Evening settled with violet clouds along the western ridge. Caravans rest by the well while lanterns flicker across the courtyard tiles.',
        ],
        imageCount: 1,
        color: 'amber',
        dateOffsetDays: 25,
      },
      {
        title: 'Cafes of Montmartre',
        paragraphs: [
          'Zinc countertops polished by decades of espresso saucers. Rain taps against the leaded glass as artists argue over charcoal weights in the back corner booth.',
        ],
        color: 'slate',
        dateOffsetDays: 20,
      },
      {
        title: 'Highlands Sleeper Train',
        paragraphs: [
          'Rattling bogies through the Scottish night. Pine boughs brush against the window glass as the carriage winds through steep valleys and midnight lochs.',
          'Woke at dawn near Fort William with frost tracing lace patterns on the double-glazed panes.',
        ],
        imageCount: 1,
        color: 'indigo',
        dateOffsetDays: 15,
      },
      {
        title: 'Coastal Cliffs of Amalfi',
        paragraphs: [
          'Terraced lemon groves carved into sheer limestone. The sea beneath shines a saturated ultramarine, reflecting midday sun like hammered silver.',
        ],
        color: 'terracotta',
        dateOffsetDays: 10,
      },
      {
        title: 'Night Market in Taipei',
        paragraphs: [
          'Steam rising from scallion pancake griddles. Red paper lanterns illuminate narrow alleyways packed with patrons seeking herbal broths and shaved ice.',
        ],
        color: 'charcoal',
        dateOffsetDays: 5,
      },
      {
        title: 'Packing List & Journal Prompts',
        paragraphs: [
          'Heavy canvas rucksack, brass pencil sharpener, two notebooks with 120gsm laid paper, collapsible umbrella, wool sweater, and a tin of watercolours.',
        ],
        color: 'linen',
        dateOffsetDays: 1,
      },
    ],
  },
  {
    key: 'food-recipes',
    title: 'Food & Recipes',
    description: 'Kitchen experiments, heirloom measurements, and seasonal tables',
    color: 'amber',
    sortOrder: 1,
    entries: [
      {
        title: 'Sourdough Crumb Notes',
        paragraphs: [
          '80% hydration flour blend using stone-ground heritage wheat. Bulk fermentation extended to 5 hours at 24 degrees Celsius with three sets of coil folds.',
          'Bake in cast iron dutch oven at 240C with two ice cubes dropped behind parchment. Blistered crust with deep mahogany caramelisation.',
        ],
        color: 'amber',
        dateOffsetDays: 24,
      },
      {
        title: 'Summer Gazpacho Method',
        paragraphs: [
          'Vine-ripened beefsteak tomatoes pressed through coarse sieve with bruised garlic, stale sourdough crumb, and unfiltered olive oil.',
        ],
        color: 'terracotta',
        dateOffsetDays: 20,
      },
      {
        title: "Grandmother's Cardamom Chai",
        paragraphs: [
          'Crush three whole green cardamom pods with a coin of ginger and one clove. Simmer in whole milk with loose Assam tea until golden tan.',
        ],
        color: 'clay',
        dateOffsetDays: 15,
      },
      {
        title: 'Handmade Soba Noodles',
        paragraphs: [
          'Buckwheat flour kneaded with icy well water on wide cypress rolling board. Cut into uniform ribbons with a heavy soba kiri knife.',
        ],
        imageCount: 1,
        color: 'slate',
        dateOffsetDays: 10,
      },
      {
        title: 'Pickled Chanterelles & Thyme',
        paragraphs: [
          'White wine vinegar, mustard seed, and fresh thyme sprigs poured hot over clean golden caps in glass preserving jars.',
        ],
        color: 'moss',
        dateOffsetDays: 5,
      },
      {
        title: 'Cast Iron Skillet Cornbread',
        paragraphs: [
          'Stone-ground yellow cornmeal sizzled in smoking bacon lard, baked until top crackles with crisp golden perimeter.',
        ],
        color: 'linen',
        dateOffsetDays: 1,
      },
    ],
  },
  {
    key: 'sketches',
    title: 'Sketches',
    description: 'Charcoal studies, ink splatters, anatomy, and streetscapes',
    color: 'charcoal',
    sortOrder: 2,
    entries: [
      {
        title: 'Old Town Fountain Vignette',
        paragraphs: ['Heavy wash of Payne grey watercolour over waterproof sepia ink lines. The gargoyle spout weathered by three centuries.'],
        imageCount: 1,
        color: 'charcoal',
        dateOffsetDays: 22,
      },
      {
        title: 'Architectural Archways',
        paragraphs: ['Romanesque semi-circular vaults drawn with 0.3mm technical fineliner and crosshatching shadows.'],
        color: 'slate',
        dateOffsetDays: 18,
      },
      {
        title: 'Continuous Line Portraits',
        paragraphs: ['Blind contour drawing without lifting the fountain pen tip from the sheet. Raw expressiveness over geometric accuracy.'],
        color: 'terracotta',
        dateOffsetDays: 15,
      },
      {
        title: 'Charcoal Light Studies',
        paragraphs: ['White chalk highlights over toned grey paper. Single directional candle illumination.'],
        color: 'paper',
        dateOffsetDays: 11,
      },
      {
        title: 'Perspective Grid Tests',
        paragraphs: ['Two-point perspective street corner layout with receding cornices and awning shadows.'],
        color: 'indigo',
        dateOffsetDays: 8,
      },
      {
        title: 'Life Drawing Session 04',
        paragraphs: ['Twenty-minute standing pose with kneaded eraser highlights and sepia conte crayon.'],
        color: 'clay',
        dateOffsetDays: 4,
      },
      {
        title: 'Quick Gesture Poses',
        paragraphs: ['Thirty-second loose charcoal poses focusing on spine curvature and balance axis.'],
        color: 'linen',
        dateOffsetDays: 1,
      },
    ],
  },
  {
    key: 'plants',
    title: 'Plants',
    description: 'Potting journals, leaf pressings, and cuttings on windowsills',
    color: 'moss',
    sortOrder: 3,
    entries: [
      {
        title: 'Fiddle Leaf Fig Recovery',
        paragraphs: ['Notched upper trunk to encourage lateral branching. Added worm castings and filtered rainwater.'],
        color: 'moss',
        dateOffsetDays: 20,
      },
      {
        title: 'Eucalyptus Leaf Pressings',
        paragraphs: ['Blue gum leaves pressed under twenty heavy volumes between archival blotter sheets for six weeks.'],
        imageCount: 1,
        color: 'paper',
        dateOffsetDays: 15,
      },
      {
        title: 'Terrarium Layering Log',
        paragraphs: ['Leca gravel base, horticultural charcoal layer, sphagnum barrier, and terrarium potting soil with pillow moss.'],
        color: 'slate',
        dateOffsetDays: 10,
      },
      {
        title: 'Spring Seedling Propagation',
        paragraphs: ['Sweet pea seeds soaked for twelve hours and planted into cardboard toilet roll tubes on warm windowsill.'],
        color: 'linen',
        dateOffsetDays: 5,
      },
      {
        title: 'Wildflower Identification',
        paragraphs: ['Found meadow cranesbill, wild carrot, and yarrow in ditch edge along country lane.'],
        color: 'amber',
        dateOffsetDays: 1,
      },
    ],
  },
  {
    key: 'music',
    title: 'Music',
    description: 'Listening logs, tape loops, vinyl notes, and harmonic ideas',
    color: 'indigo',
    sortOrder: 4,
    entries: [
      {
        title: 'Sunday Vinyl Listening Log',
        paragraphs: ['Coltrane in the morning, Brian Eno ambient works at dusk. Tube amplifier warmth filling the wooden floorboards.'],
        color: 'indigo',
        dateOffsetDays: 25,
      },
      {
        title: 'Acoustic Fingerpicking Exercises',
        paragraphs: ['Travis picking patterns in drop D tuning. Practicing thumb bass independence at 72 bpm.'],
        color: 'amber',
        dateOffsetDays: 20,
      },
      {
        title: 'Tape Loop Ambient Sketches',
        paragraphs: ['Quarter-inch magnetic tape spliced into four-second loop on Reel-to-Reel recorder, degrading gently with each pass.'],
        imageCount: 1,
        color: 'charcoal',
        dateOffsetDays: 15,
      },
      {
        title: 'Favorite Rhythms & Time Signatures',
        paragraphs: ['Balkan 7/8 folk dances (3+2+2) and polyrhythmic Afrobeat interlocking guitar lines.'],
        color: 'slate',
        dateOffsetDays: 10,
      },
      {
        title: 'Concert Ticket Stubs & Setlists',
        paragraphs: ['Acoustic trio at the old brick cellar in Autumn. Memorable encore with upright bass bowed harmonics.'],
        color: 'paper',
        dateOffsetDays: 5,
      },
      {
        title: 'Late Night Chord Progressions',
        paragraphs: ['Maj9 to minor 11ths with voice-leading through chromatic passing tones.'],
        color: 'plum',
        dateOffsetDays: 1,
      },
    ],
  },
  {
    key: 'ideas',
    title: 'Ideas',
    description: 'Fragments, architectural scraps, essay seeds, and questions',
    color: 'terracotta',
    sortOrder: 5,
    entries: SEED_IDEAS_ENTRIES,
  },
  {
    key: 'memories',
    title: 'Memories',
    description: 'Photographs, pressed tickets, letters, and quiet afternoons',
    color: 'slate',
    sortOrder: 6,
    entries: [
      {
        title: 'Summer of 1998 in the Orchard',
        paragraphs: ['Apple blossoms falling like snow. Climbing the old walnut tree with a paperback adventure novel.'],
        color: 'amber',
        dateOffsetDays: 30,
      },
      {
        title: 'Letters from Old Friends',
        paragraphs: ['Postcards with airmail borders preserved in a cardboard shoe box tied with blue twine.'],
        color: 'paper',
        dateOffsetDays: 20,
      },
      {
        title: 'Ticket to the Seaside Pavilion',
        paragraphs: ['Pier carousel organ music playing across salt spray as fog rolled into the bay.'],
        color: 'slate',
        dateOffsetDays: 10,
      },
      {
        title: 'Photographs from the Darkroom',
        paragraphs: ['Faint silver halides emerging in the developer tray under red safelight glow.'],
        imageCount: 1,
        color: 'charcoal',
        dateOffsetDays: 1,
      },
    ],
  },
];

export class CategoriesService {
  private categories: Map<string, Category> = new Map();
  private entries: Map<string, EntryRecord> = new Map();
  private baseDataDir: string;
  private dataFilePath: string;
  private assetStore: LocalDiskAssetStore;
  private seedCoversDir: string;
  private initialized = false;

  constructor(baseDataDir: string, assetStore: LocalDiskAssetStore, seedCoversDir: string) {
    this.baseDataDir = baseDataDir;
    this.dataFilePath = path.join(baseDataDir, 'db-store.json');
    this.assetStore = assetStore;
    this.seedCoversDir = seedCoversDir;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(path.dirname(this.dataFilePath), { recursive: true });
      const raw = await fs.readFile(this.dataFilePath, 'utf8');
      const data = JSON.parse(raw);
      for (const cat of data.categories || []) {
        this.categories.set(cat.id, {
          ...cat,
          todo: Array.isArray(cat.todo) ? cat.todo : [],
          version: typeof cat.version === 'number' ? cat.version : 1,
        });
      }
      for (const ent of data.entries || []) {
        this.entries.set(ent.id, ent);
      }
    } catch {
      await this.seed();
    }

    // If categories empty or ideas category has fewer than 60 entries, reseed
    const ideasEntries = Array.from(this.entries.values()).filter(
      (e) => e.categoryId === 'cat_ideas' && !e.deletedAt
    );
    if (this.categories.size === 0 || ideasEntries.length < 60) {
      await this.seed();
    }

    // Auto-migrate entries to chunked storage if not yet migrated
    try {
      const entriesDir = path.join(this.baseDataDir, 'entries');
      let needsMigration = false;
      try {
        const stats = await fs.stat(entriesDir);
        if (!stats.isDirectory()) needsMigration = true;
      } catch {
        needsMigration = true;
      }
      if (needsMigration) {
        await migrateEntriesToChunks(this.baseDataDir, Array.from(this.entries.values()));
      }
    } catch (migErr) {
      console.warn('Initial chunk migration notice:', migErr);
    }

    this.initialized = true;
  }

  private async persist(): Promise<void> {
    const data = {
      categories: Array.from(this.categories.values()),
      entries: Array.from(this.entries.values()),
    };
    const tmpPath = `${this.dataFilePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmpPath, this.dataFilePath);
  }

  private async seed(): Promise<void> {
    const nowMs = Date.now();
    const coverAssetMap = new Map<string, string>();

    // Register static covers via real AssetStore as required by spec
    for (const item of SEED_COVERS_MANIFEST) {
      try {
        const svgPath = path.join(this.seedCoversDir, item.fileName);
        const svgBuffer = await fs.readFile(svgPath);
        const pngBuffer = await sharp(svgBuffer).png().toBuffer();
        const { asset } = await this.assetStore.put(pngBuffer, 'image/png', item.fileName);
        coverAssetMap.set(item.key, asset.id);
      } catch (err) {
        console.warn(`Could not seed cover for ${item.key}:`, err);
      }
    }

    // Clear and rebuild initial categories & entries
    this.categories.clear();
    this.entries.clear();

    for (const seedCat of SEED_CATEGORIES_DATA) {
      const catId = `cat_${seedCat.key}`;
      const coverAssetId = coverAssetMap.get(seedCat.key);
      const catCreatedAt = new Date(nowMs - 180 * 24 * 60 * 60 * 1000).toISOString();

      const category: Category = {
        id: catId,
        title: seedCat.title,
        description: seedCat.description,
        coverAssetId,
        sortOrder: seedCat.sortOrder,
        color: seedCat.color,
        todo: [],
        version: 1,
        createdAt: catCreatedAt,
        updatedAt: catCreatedAt,
        deletedAt: null,
      };

      this.categories.set(catId, category);

      let entryIndex = 0;
      for (const entrySpec of seedCat.entries) {
        const entryId = `entry_${seedCat.key}_${entryIndex + 1}`;
        const offsetDays = entrySpec.dateOffsetDays ?? (seedCat.entries.length - entryIndex);
        const entryTimestamp = new Date(nowMs - offsetDays * 24 * 60 * 60 * 1000 + entryIndex * 60000).toISOString();

        // Build document body blocks with varied, realistic length based on entry index
        const topLevelBlocks: TopLevelBlock[] = [
          {
            type: 'heading',
            attrs: { id: `blk_${entryId}_0`, level: 1, textAlign: 'left' },
            content: [{ type: 'text', text: entrySpec.title }],
          },
        ];

        // Give entries varied text lengths and formatting
        // First 10 entries vary nicely (weights 3 to 18, heights 48px to 65px)
        const repetitions = entryIndex < 10
          ? ((entryIndex % 4) + 1)
          : ((entryIndex % 8) + 2);

        for (let r = 0; r < repetitions; r++) {
          for (let pIdx = 0; pIdx < entrySpec.paragraphs.length; pIdx++) {
            const pText = entrySpec.paragraphs[pIdx];
            topLevelBlocks.push({
              type: 'paragraph',
              attrs: { id: `blk_${entryId}_p_${r}_${pIdx}`, textAlign: 'left' },
              content: [{ type: 'text', text: pText }],
            });
          }
        }

        // Add a blockquote or divider periodically
        if (entryIndex % 3 === 0) {
          topLevelBlocks.push({
            type: 'blockquote',
            attrs: { id: `blk_${entryId}_q` },
            content: [
              {
                type: 'paragraph',
                attrs: { id: `blk_${entryId}_qp`, textAlign: 'left' },
                content: [{ type: 'text', text: 'Collecting fragments is not hoarding; it is an act of sense-making.' }],
              },
            ],
          });
        }
        if (entryIndex % 4 === 0) {
          topLevelBlocks.push({
            type: 'horizontalRule',
            attrs: { id: `blk_${entryId}_hr` },
          });
        }

        const doc: DocumentEnvelopeV2 = {
          schemaVersion: 2,
          doc: {
            type: 'doc',
            content: topLevelBlocks,
          },
        };

        const calculatedWeight = calculateWeight(doc);
        const stats = calculateEntryStats(doc);

        const entry: EntryRecord = {
          id: entryId,
          categoryId: catId,
          title: entrySpec.title,
          sortOrder: entryIndex++,
          color: entrySpec.color || seedCat.color,
          pinned: entrySpec.pinned ?? false,
          spine: entrySpec.spine || null,
          stats,
          weight: calculatedWeight,
          version: 1,
          doc,
          createdAt: entryTimestamp,
          updatedAt: entryTimestamp,
          deletedAt: null,
          lastOpenedAt: null,
        };

        this.entries.set(entryId, entry);
      }
    }

    await this.persist();
  }

  async listCategories(): Promise<CategoryLightRow[]> {
    await this.init();

    const result: CategoryLightRow[] = [];
    for (const cat of this.categories.values()) {
      if (cat.deletedAt) continue;

      let entryCount = 0;
      for (const entry of this.entries.values()) {
        if (entry.categoryId === cat.id && !entry.deletedAt) {
          entryCount++;
        }
      }

      result.push({
        ...cat,
        entryCount,
      });
    }

    return result.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getCategory(id: string): Promise<Category | null> {
    await this.init();
    const category = this.categories.get(id);
    if (!category || category.deletedAt) return null;
    return category;
  }

  async createCategory(title: string, coverAssetId?: string, color?: string): Promise<CategoryLightRow> {
    await this.init();
    const now = new Date().toISOString();
    const count = this.categories.size;
    const id = `cat_${Date.now()}`;

    const newCat: Category = {
      id,
      title: title.trim(),
      description: '',
      coverAssetId,
      sortOrder: count,
      color: color || 'terracotta',
      todo: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    this.categories.set(id, newCat);
    await this.persist();

    return {
      ...newCat,
      entryCount: 0,
    };
  }

  async updateCategory(
    id: string,
    updates: Partial<Pick<Category, 'title' | 'description' | 'coverAssetId' | 'color' | 'sortOrder' | 'todo'>>,
    expectedVersion?: number
  ): Promise<{ category: Category } | { conflict: true; currentVersion: number } | null> {
    await this.init();
    const cat = this.categories.get(id);
    if (!cat || cat.deletedAt) return null;

    if (expectedVersion !== undefined && cat.version !== expectedVersion) {
      return { conflict: true, currentVersion: cat.version };
    }

    const updated: Category = {
      ...cat,
      ...updates,
      version: (cat.version || 1) + 1,
      updatedAt: new Date().toISOString(),
    };

    this.categories.set(id, updated);
    await this.persist();
    return { category: updated };
  }

  async getCategoryStats(categoryId: string): Promise<CategoryStats | null> {
    await this.init();
    const cat = this.categories.get(categoryId);
    if (!cat || cat.deletedAt) return null;

    const catEntries = Array.from(this.entries.values()).filter(
      (e) => e.categoryId === categoryId && !e.deletedAt
    );

    let words = 0;
    let images = 0;
    let latestUpdatedAt = cat.createdAt;

    for (const e of catEntries) {
      const stats = e.stats ?? calculateEntryStats(e.doc);
      words += stats.words;
      images += stats.images;
      if (e.updatedAt > latestUpdatedAt) {
        latestUpdatedAt = e.updatedAt;
      }
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const entriesPerMonth: MonthEntryCount[] = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const monthIndex = d.getMonth();
      const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
      const label = monthNames[monthIndex];
      entriesPerMonth.push({
        month: monthKey,
        label,
        count: 0,
      });
    }

    for (const e of catEntries) {
      const entryMonth = e.createdAt.slice(0, 7);
      const bucket = entriesPerMonth.find((b) => b.month === entryMonth);
      if (bucket) {
        bucket.count++;
      }
    }

    return {
      entries: catEntries.length,
      words,
      images,
      createdAt: cat.createdAt,
      lastEditedAt: catEntries.length > 0 ? latestUpdatedAt : cat.updatedAt,
      entriesPerMonth,
    };
  }

  async deleteCategory(id: string): Promise<boolean> {
    await this.init();
    const cat = this.categories.get(id);
    if (!cat || cat.deletedAt) return false;

    cat.deletedAt = new Date().toISOString();
    this.categories.set(id, cat);
    await this.persist();
    return true;
  }

  async restoreCategory(id: string): Promise<Category | null> {
    await this.init();
    const cat = this.categories.get(id);
    if (!cat || !cat.deletedAt) return null;

    cat.deletedAt = null;
    cat.updatedAt = new Date().toISOString();
    this.categories.set(id, cat);
    await this.persist();
    return cat;
  }

  /**
   * List light rows for entries in a category (never load doc).
   * Caps at 500 rows per spec.
   */
  async listEntriesForCategory(categoryId: string): Promise<EntryLightRow[]> {
    await this.init();
    const rows: EntryLightRow[] = [];

    for (const e of this.entries.values()) {
      if (e.categoryId === categoryId && !e.deletedAt) {
        rows.push({
          id: e.id,
          categoryId: e.categoryId,
          title: e.title,
          weight: e.weight,
          sortOrder: e.sortOrder,
          color: e.color ?? null,
          pinned: e.pinned,
          spine: e.spine ?? null,
          stats: e.stats ?? calculateEntryStats(e.doc),
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
          lastOpenedAt: e.lastOpenedAt ?? null,
          deletedAt: null,
        });
      }
    }

    // Cap at 500 entries per spec
    return rows.slice(0, 500);
  }

  /**
   * Run explicit migration with immutable backup.
   */
  async runMigration(): Promise<MigrationResult> {
    await this.init();
    return migrateEntriesToChunks(this.baseDataDir, Array.from(this.entries.values()));
  }

  /**
   * Get manifest for an entry.
   */
  async getEntryManifest(id: string): Promise<EntryManifest | null> {
    await this.init();
    const entry = this.entries.get(id);
    if (!entry || entry.deletedAt) return null;

    const manifestPath = path.join(this.baseDataDir, 'entries', id, 'manifest.json');
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      return JSON.parse(raw);
    } catch {
      // Manifest does not exist on disk yet, generate from entry.doc
      if (entry.doc) {
        const v2Doc = entry.doc.schemaVersion === 2
          ? entry.doc
          : migrateDocumentToV2(entry.doc).doc;
        const blocks = Array.isArray(v2Doc.doc?.content) ? v2Doc.doc.content : [];
        const { manifest, chunks } = splitBlocksIntoChunks(blocks, {
          entryId: id,
          version: entry.version,
        });

        // Persist manifest and chunks
        const entryDir = path.join(this.baseDataDir, 'entries', id);
        const chunksDir = path.join(entryDir, 'chunks');
        await fs.mkdir(chunksDir, { recursive: true });
        for (const chk of chunks) {
          const chkPath = path.join(chunksDir, `${chk.chunkId}.json`);
          await fs.writeFile(chkPath, JSON.stringify(chk, null, 2), 'utf8');
        }
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        return manifest;
      }
      return null;
    }
  }

  /**
   * Get single chunk payload for an entry.
   */
  async getEntryChunk(entryId: string, chunkId: string): Promise<ChunkPayload | null> {
    await this.init();
    const entry = this.entries.get(entryId);
    if (!entry || entry.deletedAt) return null;

    const chunkPath = path.join(this.baseDataDir, 'entries', entryId, 'chunks', `${chunkId}.json`);
    try {
      const raw = await fs.readFile(chunkPath, 'utf8');
      return JSON.parse(raw);
    } catch {
      // If chunk file is missing, ensure manifest is initialized
      await this.getEntryManifest(entryId);
      try {
        const retryRaw = await fs.readFile(chunkPath, 'utf8');
        return JSON.parse(retryRaw);
      } catch {
        return null;
      }
    }
  }

  /**
   * Save a single chunk with version concurrency check and atomic writes.
   * Handles chunk splitting when blocks exceed limits, and chunk merging when blocks are deleted.
   */
  async saveEntryChunk(
    entryId: string,
    chunkId: string,
    blocks: TopLevelBlock[],
    expectedVersion?: number
  ): Promise<
    | { conflict: true; currentVersion: number }
    | {
        success: true;
        chunkId: string;
        version: number;
        weight: number;
        stats?: EntryStats;
        manifest: EntryManifest;
      }
  > {
    await this.init();
    const entry = this.entries.get(entryId);
    if (!entry || entry.deletedAt) {
      throw new Error(`Entry "${entryId}" not found`);
    }

    if (expectedVersion !== undefined && entry.version !== expectedVersion) {
      return { conflict: true, currentVersion: entry.version };
    }

    // Ensure manifest is loaded
    let manifest = await this.getEntryManifest(entryId);
    if (!manifest) {
      throw new Error(`Failed to load manifest for entry "${entryId}"`);
    }

    const entryDir = path.join(this.baseDataDir, 'entries', entryId);
    const chunksDir = path.join(entryDir, 'chunks');
    await fs.mkdir(chunksDir, { recursive: true });

    const chunkIndex = manifest.chunks.findIndex((c) => c.id === chunkId);
    if (chunkIndex === -1 && manifest.chunks.length > 0) {
      throw new Error(`Chunk "${chunkId}" not found in manifest`);
    }

    // Split or merge handling
    const serializedBlocks = JSON.stringify(blocks);
    const byteSize = new TextEncoder().encode(serializedBlocks).length;
    const isOverLimit = blocks.length > 50 || byteSize > 64 * 1024;
    const isEmpty = blocks.length === 0;

    let updatedChunkIds: string[] = [];

    if (isEmpty && manifest.chunks.length > 1) {
      // Merge/delete empty chunk
      manifest.chunks.splice(chunkIndex, 1);
      try {
        await fs.unlink(path.join(chunksDir, `${chunkId}.json`));
      } catch {
        // Ignore if file does not exist
      }
    } else if (isOverLimit) {
      // Split chunk into multiple chunks
      const { manifest: splitSubManifest, chunks: splitChunks } = splitBlocksIntoChunks(blocks, {
        entryId,
        version: entry.version + 1,
      });

      // Write each split chunk
      for (let sIdx = 0; sIdx < splitChunks.length; sIdx++) {
        const sc = splitChunks[sIdx];
        const targetId = sIdx === 0 ? chunkId : `chk_${entryId}_${Date.now()}_${sIdx}`;
        sc.chunkId = targetId;
        const targetMeta = splitSubManifest.chunks[sIdx];
        targetMeta.id = targetId;

        const chkFile = path.join(chunksDir, `${targetId}.json`);
        const tmpFile = `${chkFile}.tmp`;
        await fs.writeFile(tmpFile, JSON.stringify(sc, null, 2), 'utf8');
        await fs.rename(tmpFile, chkFile);
        updatedChunkIds.push(targetId);
      }

      // Replace chunk in manifest with split chunk metadata
      manifest.chunks.splice(chunkIndex, 1, ...splitSubManifest.chunks);
    } else {
      // Single chunk update: write ONLY this chunk file
      const safeBlocks: TopLevelBlock[] = blocks.length > 0 ? blocks : [
        { type: 'paragraph' as const, attrs: { id: 'blk_initial' }, content: [] }
      ];
      const payload: ChunkPayload = {
        chunkId,
        entryId,
        blocks: safeBlocks,
      };

      const chkFile = path.join(chunksDir, `${chunkId}.json`);
      const tmpFile = `${chkFile}.tmp`;
      await fs.writeFile(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
      await fs.rename(tmpFile, chkFile);
      updatedChunkIds.push(chunkId);

      // Compute stats for this chunk
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
      for (const b of safeBlocks) walk(b);

      const targetMeta = manifest.chunks[chunkIndex] || {
        id: chunkId,
        order: chunkIndex,
        blockCount: safeBlocks.length,
        bytes: byteSize,
        checksum: computeContentHash(safeBlocks),
      };

      targetMeta.blockCount = safeBlocks.length;
      targetMeta.bytes = byteSize;
      targetMeta.checksum = computeContentHash(safeBlocks);
      targetMeta.charCount = chunkChars;
      targetMeta.imageCount = chunkImages;
      targetMeta.wordCount = chunkWords;

      if (chunkIndex === -1) {
        manifest.chunks.push(targetMeta);
      } else {
        manifest.chunks[chunkIndex] = targetMeta;
      }
    }

    // Re-index orders and sum totals
    let totalBlocks = 0;
    let totalWords = 0;
    let totalImages = 0;
    let totalChars = 0;

    manifest.chunks.forEach((c, idx) => {
      c.order = idx;
      totalBlocks += c.blockCount;
      totalWords += c.wordCount ?? 0;
      totalImages += c.imageCount ?? 0;
      totalChars += c.charCount ?? 0;
    });

    manifest.chunkCount = manifest.chunks.length;
    manifest.totalBlocks = totalBlocks;
    manifest.stats = {
      words: totalWords,
      images: totalImages,
      charCount: totalChars,
    };
    manifest.version = entry.version + 1;
    manifest.updatedAt = new Date().toISOString();

    // Atomic manifest write
    const manifestPath = path.join(entryDir, 'manifest.json');
    const tmpManifestPath = `${manifestPath}.tmp`;
    await fs.writeFile(tmpManifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    await fs.rename(tmpManifestPath, manifestPath);

    // Update entry record
    entry.version = manifest.version;
    entry.weight = calculateWeight(manifest);
    entry.stats = { words: totalWords, images: totalImages };
    entry.updatedAt = manifest.updatedAt;

    // Keep entry.doc in memory updated by reassembling chunks
    const allChunkPayloads: ChunkPayload[] = [];
    for (const c of manifest.chunks) {
      try {
        const raw = await fs.readFile(path.join(chunksDir, `${c.id}.json`), 'utf8');
        allChunkPayloads.push(JSON.parse(raw));
      } catch {
        allChunkPayloads.push({ chunkId: c.id, entryId, blocks: [] });
      }
    }
    entry.doc = reassembleDocFromChunks(allChunkPayloads);

    this.entries.set(entryId, entry);
    await this.persist();

    return {
      success: true,
      chunkId,
      version: entry.version,
      weight: entry.weight,
      stats: entry.stats,
      manifest,
    };
  }

  /**
   * Get full entry row by id (including doc).
   */
  async getEntry(id: string): Promise<EntryRecord | null> {
    await this.init();
    const entry = this.entries.get(id);
    if (!entry || entry.deletedAt) return null;

    // Load from chunked manifest if available
    const manifestPath = path.join(this.baseDataDir, 'entries', id, 'manifest.json');
    try {
      const rawManifest = await fs.readFile(manifestPath, 'utf8');
      const manifest: EntryManifest = JSON.parse(rawManifest);
      const chunksDir = path.join(this.baseDataDir, 'entries', id, 'chunks');
      const chunkPayloads: ChunkPayload[] = [];
      for (const chkMeta of manifest.chunks) {
        const chunkFilePath = path.join(chunksDir, `${chkMeta.id}.json`);
        const chunkRaw = await fs.readFile(chunkFilePath, 'utf8');
        chunkPayloads.push(JSON.parse(chunkRaw));
      }
      entry.doc = reassembleDocFromChunks(chunkPayloads);
      entry.weight = calculateWeight(manifest);
      if (manifest.stats) {
        entry.stats = { words: manifest.stats.words, images: manifest.stats.images };
      }
    } catch {
      // Fall back to entry.doc
    }

    return entry;
  }

  /**
   * Create new entry in a category.
   */
  async createEntry(
    categoryId: string,
    title = 'Untitled',
    color?: string,
    pinned = false,
    spine?: SpineStyle,
    docInput?: DocumentEnvelope
  ): Promise<EntryRecord> {
    await this.init();
    const now = new Date().toISOString();
    const entryId = `entry_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const cleanTitle = title.trim() || 'Untitled';

    const doc = docInput
      ? (docInput.schemaVersion === 2 ? docInput : migrateDocumentToV2(docInput).doc)
      : createEmptyDocument();
    const weightVal = calculateWeight(doc);
    const stats = calculateEntryStats(doc);

    // Count existing unpinned entries for sortOrder
    const existing = Array.from(this.entries.values()).filter(
      (e) => e.categoryId === categoryId && !e.deletedAt
    );

    const newEntry: EntryRecord = {
      id: entryId,
      categoryId,
      title: cleanTitle,
      sortOrder: existing.length,
      color: color || null,
      pinned,
      spine: spine || null,
      stats,
      weight: weightVal,
      version: 1,
      doc,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      lastOpenedAt: now,
    };

    // Persist initial manifest and chunks for new entry
    try {
      const v2Doc = (doc.schemaVersion === 2 ? doc : migrateDocumentToV2(doc).doc) as DocumentEnvelopeV2;
      const blocks: TopLevelBlock[] = Array.isArray(v2Doc.doc?.content) ? v2Doc.doc.content : [];
      const { manifest, chunks } = splitBlocksIntoChunks(blocks, {
        entryId,
        version: 1,
      });

      const entryDir = path.join(this.baseDataDir, 'entries', entryId);
      const chunksDir = path.join(entryDir, 'chunks');
      await fs.mkdir(chunksDir, { recursive: true });

      for (const chk of chunks) {
        const chkFile = path.join(chunksDir, `${chk.chunkId}.json`);
        const tmpFile = `${chkFile}.tmp`;
        await fs.writeFile(tmpFile, JSON.stringify(chk, null, 2), 'utf8');
        await fs.rename(tmpFile, chkFile);
      }

      const manifestPath = path.join(entryDir, 'manifest.json');
      const tmpManifest = `${manifestPath}.tmp`;
      await fs.writeFile(tmpManifest, JSON.stringify(manifest, null, 2), 'utf8');
      await fs.rename(tmpManifest, manifestPath);
    } catch (chunkErr) {
      console.warn('Failed to persist initial chunks for entry:', chunkErr);
    }

    this.entries.set(entryId, newEntry);
    await this.persist();
    return newEntry;
  }

  /**
   * Update entry metadata (title, categoryId, color, pinned, sortOrder, spine).
   */
  async updateEntry(
    id: string,
    updates: {
      title?: string;
      categoryId?: string;
      color?: string | null;
      pinned?: boolean;
      sortOrder?: number;
      spine?: SpineStyle | null;
    }
  ): Promise<EntryRecord | null> {
    await this.init();
    const entry = this.entries.get(id);
    if (!entry || entry.deletedAt) return null;

    if (updates.title !== undefined) entry.title = updates.title.trim();
    if (updates.categoryId !== undefined) entry.categoryId = updates.categoryId;
    if (updates.color !== undefined) entry.color = updates.color;
    if (updates.pinned !== undefined) entry.pinned = updates.pinned;
    if (updates.sortOrder !== undefined) entry.sortOrder = updates.sortOrder;
    if (updates.spine !== undefined) entry.spine = updates.spine;

    entry.updatedAt = new Date().toISOString();
    this.entries.set(id, entry);
    await this.persist();
    return entry;
  }

  /**
   * Save document envelope and compute weight & stats.
   */
  async saveEntryDoc(
    id: string,
    doc: DocumentEnvelope,
    expectedVersion?: number,
    title?: string
  ): Promise<{ conflict: true; currentVersion: number } | { entry: EntryRecord; saved: boolean }> {
    await this.init();
    const entry = this.entries.get(id);
    if (!entry || entry.deletedAt) {
      throw new Error('Entry not found');
    }

    if (expectedVersion !== undefined && entry.version !== expectedVersion) {
      return { conflict: true, currentVersion: entry.version };
    }

    const v2Doc = doc.schemaVersion === 2 ? doc : migrateDocumentToV2(doc).doc;
    const blocks: TopLevelBlock[] = Array.isArray(v2Doc.doc?.content) ? v2Doc.doc.content : [];

    // Get existing manifest if present to preserve stable chunk ids
    const manifestPath = path.join(this.baseDataDir, 'entries', id, 'manifest.json');
    let existingManifest: EntryManifest | null = null;
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      existingManifest = JSON.parse(raw);
    } catch {}

    const { manifest, chunks } = splitBlocksIntoChunks(blocks, {
      entryId: id,
      version: entry.version + 1,
      existingChunks: existingManifest?.chunks,
    });

    const entryDir = path.join(this.baseDataDir, 'entries', id);
    const chunksDir = path.join(entryDir, 'chunks');
    await fs.mkdir(chunksDir, { recursive: true });

    // Atomically write all chunks
    const activeChunkIds = new Set(chunks.map((c) => c.chunkId));
    for (const chk of chunks) {
      const chkFile = path.join(chunksDir, `${chk.chunkId}.json`);
      const tmpFile = `${chkFile}.tmp`;
      await fs.writeFile(tmpFile, JSON.stringify(chk, null, 2), 'utf8');
      await fs.rename(tmpFile, chkFile);
    }

    // Clean up old removed chunks
    try {
      const existingFiles = await fs.readdir(chunksDir);
      for (const file of existingFiles) {
        if (file.endsWith('.json')) {
          const chkId = file.replace(/\.json$/, '');
          if (!activeChunkIds.has(chkId)) {
            await fs.unlink(path.join(chunksDir, file)).catch(() => {});
          }
        }
      }
    } catch {}

    // Atomically write manifest
    const tmpManifestPath = `${manifestPath}.tmp`;
    await fs.writeFile(tmpManifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    await fs.rename(tmpManifestPath, manifestPath);

    entry.doc = doc;
    if (title !== undefined && title.trim()) {
      entry.title = title.trim();
    }
    entry.weight = calculateWeight(manifest);
    entry.stats = calculateEntryStats(doc);
    entry.version = manifest.version;
    entry.updatedAt = manifest.updatedAt;

    this.entries.set(id, entry);
    await this.persist();
    return { entry, saved: true };
  }

  /**
   * Soft delete entry.
   */
  async deleteEntry(id: string): Promise<boolean> {
    await this.init();
    const entry = this.entries.get(id);
    if (!entry || entry.deletedAt) return false;

    entry.deletedAt = new Date().toISOString();
    this.entries.set(id, entry);
    await this.persist();
    return true;
  }

  /**
   * Restore soft-deleted entry.
   */
  async restoreEntry(id: string): Promise<EntryRecord | null> {
    await this.init();
    const entry = this.entries.get(id);
    if (!entry || !entry.deletedAt) return null;

    entry.deletedAt = null;
    entry.updatedAt = new Date().toISOString();
    this.entries.set(id, entry);
    await this.persist();
    return entry;
  }
}
