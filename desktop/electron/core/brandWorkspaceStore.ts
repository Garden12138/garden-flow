import type { ProductLink, LinkProductsInput } from '../../shared/productLinks.ts';
import { splitProductReviewMetadata } from '../../shared/productReviewMetadata.ts';
import { isProductCaptureUiImage, readProductMedia, validateProductCaptureIdentity, validateProductMediaSource } from './productCapturePolicy.ts';
import { capturedMediaKey } from './productCaptureMedia.ts';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { resolveAssetSourceToPath, toAppAssetUrl } from './localAssetManager.ts';

export const UNASSIGNED_BRAND_ID = 'brand_unassigned';

export type ProductChange = { root: string; productId: string; updatedAt?: string; reason: 'product-updated' | 'product-deleted' };
const productEvents = new EventEmitter();
const catalogQueues = new Map<string, Promise<void>>();
const pendingCatalogWrites = new Map<string, number>();
export function onProductChanged(listener: (change: ProductChange) => void): () => void {
  productEvents.on('changed', listener);
  return () => productEvents.off('changed', listener);
}

export type BrandWorkspaceImageInput = {
  id?: string;
  name?: string;
  path?: string;
  dataUrl?: string;
  sourceUrl?: string;
  role?: string;
  origin?: 'user' | 'capture' | 'generated';
};

export type BrandWorkspaceFact = {
  key: string;
  value: string;
  origin: 'captured' | 'user-confirmed' | 'ai-derived';
  sourceSnapshotId?: string;
  updatedAt: string;
};

export type BrandWorkspaceBrand = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

export type BrandWorkspaceProduct = {
  id: string;
  brandId?: string;
  name: string;
  description?: string;
  audience?: string;
  usageScenarios?: string[];
  brandStyle?: string;
  facts: BrandWorkspaceFact[];
  createdAt: string;
  updatedAt: string;
  userEditedAt?: string;
};

export type BrandWorkspaceSku = {
  id: string;
  productId: string;
  name: string;
  variantText?: string;
  externalId?: string;
  createdAt: string;
  updatedAt: string;
  userEditedAt?: string;
};

type StoredAssetRef = {
  id: string;
  ownerType: 'brand' | 'product' | 'sku' | 'product-detail' | 'product-review';
  ownerId: string;
  relativePath: string;
  sourceUrl?: string;
  role: string;
  origin: 'user' | 'capture' | 'generated';
  // Retain historical snapshot files, but stop offering verified UI graphics in new creations.
  excludedFromCreative?: true;
  createdAt: string;
};

export type BrandWorkspaceAssetRef = Omit<StoredAssetRef, 'relativePath'> & {
  path: string;
  absolutePath: string;
};

export type ProductCreativeReference = {
  type: 'product-creative-reference';
  id: string;
  name: string;
  updatedAt: string;
  productVersion: string;
  brandName?: string;
  description?: string;
  audience?: string;
  usageScenarios: string[];
  brandStyle?: string;
  facts: Array<{ key: string; value: string; origin: BrandWorkspaceFact['origin'] }>;
  skus: Array<{ id: string; name: string; variantText?: string; externalId?: string }>;
  sources: Array<{
    platform: string;
    sourceUrl: string;
    capturedAt: string;
    price?: ProductSourceSnapshot['price'];
    parameters: Array<{ key: string; value: string }>;
  }>;
  reviews: ProductReviewReference[];
  assets: Array<{
    id: string;
    role: string;
    origin: StoredAssetRef['origin'];
    previewUrl: string;
  }>;
};

export type ProductReviewFilter = {
  id: string;
  label: string;
  countText?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
};

export type ProductReviewResult = {
  filterId: string;
  label: string;
  requested: number;
  captured: number;
  availableCount?: number;
  status: 'complete' | 'partial' | 'missing';
  warning?: string;
  captureAll?: boolean;
};

export type ProductReviewRecord = {
  id: string;
  platformReviewId?: string;
  authorName?: string;
  text: string;
  merchantReply?: string;
  rating?: number;
  sentiment?: 'positive' | 'neutral' | 'negative';
  matchedFilterIds: string[];
  dateText?: string;
  skuText?: string;
  badges?: string[];
  helpfulCount?: number;
  imageAssetIds: string[];
  sourceImages?: Array<{
    sourceUrl: string;
    status?: 'localized' | 'failed' | 'skipped';
  }>;
  video?: { present: true; sourceUrl?: string };
};

export type ProductReviewCapture = {
  modalDetected: boolean;
  status: 'not-opened' | 'ready' | 'complete' | 'partial';
  availableFilters: ProductReviewFilter[];
  selectedFilters: Array<{ id: string; label: string; limit: number; captureAll?: boolean }>;
  results: ProductReviewResult[];
  reviews: ProductReviewRecord[];
  warnings: string[];
  activeFilterId?: string;
  sortText?: string;
  scopeText?: string;
};

export type ProductReviewReference = Pick<ProductReviewRecord,
  'id' | 'authorName' | 'text' | 'rating' | 'sentiment' | 'matchedFilterIds' | 'dateText' | 'skuText' | 'badges' | 'helpfulCount'
> & {
  filterLabels: string[];
  capturedAt: string;
};

export type CapturedProductReview = Omit<ProductReviewRecord, 'imageAssetIds' | 'sourceImages'> & {
  imageSourceUrls?: string[];
  images?: BrandWorkspaceImageInput[];
  sourceImages?: ProductReviewRecord['sourceImages'];
};

export type CapturedProductReviewCapture = Omit<ProductReviewCapture, 'reviews'> & {
  reviews: CapturedProductReview[];
};

export type ProductSourceSnapshot = {
  captureVersion?: number;
  id: string;
  productId: string;
  platform: 'jd' | string;
  externalId: string;
  sourceUrl: string;
  capturedAt: string;
  title: string;
  brandName?: string;
  shopName?: string;
  description?: string;
  selectedSku?: {
    externalId?: string;
    name: string;
    variantText?: string;
  };
  price?: {
    text: string;
    currency?: string;
    label?: string;
  };
  parameters: Array<{ key: string; value: string }>;
  detailText?: string;
  imageAssetIds: string[];
  sourceImages?: Array<{ sourceUrl: string; role: string }>;
  reviewCapture?: ProductReviewCapture;
  missingFields: string[];
};

export type BrandWorkspaceProductDetailPage = {
  id: string;
  productId: string;
  platform: string;
  market: string;
  locale: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
};

type BrandWorkspaceCatalog = {
  version: 1;
  brands: BrandWorkspaceBrand[];
  products: BrandWorkspaceProduct[];
  skus: BrandWorkspaceSku[];
  assets: StoredAssetRef[];
  sourceSnapshots: ProductSourceSnapshot[];
  productLinks: ProductLink[];
  detailPages: BrandWorkspaceProductDetailPage[];
};

export type CapturedProductInput = {
  captureVersion?: number;
  platform: 'jd' | string;
  externalId: string;
  sourceUrl: string;
  capturedAt?: string;
  title: string;
  brandName?: string;
  shopName?: string;
  description?: string;
  selectedSku?: {
    externalId?: string;
    name?: string;
    variantText?: string;
  };
  price?: { text?: string; currency?: string; label?: string };
  parameters?: Array<{ key?: string; value?: string }>;
  detailText?: string;
  images?: BrandWorkspaceImageInput[];
  sourceImages?: Array<{ sourceUrl: string; role: string }>;
  reviewOptions?: {
    selectedFilterIds?: string[];
    selectedFilterLabels?: string[];
    filterLabels?: Record<string, string>;
    limitPerFilter?: number;
    filterLimits?: Record<string, number>;
    captureAll?: boolean;
  };
  reviewCapture?: CapturedProductReviewCapture;
  missingFields?: string[];
};

const EMPTY_CATALOG: BrandWorkspaceCatalog = {
  version: 1,
  brands: [],
  products: [],
  skus: [],
  assets: [],
  sourceSnapshots: [],
  productLinks: [],
  detailPages: [],
};

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function nowIso(): string {
  return new Date().toISOString();
}

function cleanText(value: unknown, maxLength = 20_000): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanReviewText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanLines(value: unknown, maxLength = 50_000): string {
  return String(value || '').replace(/\r/g, '').trim().slice(0, maxLength);
}

function cleanId(value: unknown): string {
  return cleanText(value, 500).replace(/[^a-zA-Z0-9._:-]/g, '-');
}

function cleanStringList(value: unknown, limit = 100): string[] {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, 1_000))
    .filter(Boolean)))
    .slice(0, limit);
}

function normalizeFacts(value: unknown, defaultOrigin: BrandWorkspaceFact['origin'] = 'user-confirmed'): BrandWorkspaceFact[] {
  const entries = Array.isArray(value) ? value : [];
  const result: BrandWorkspaceFact[] = [];
  const seen = new Set<string>();
  for (const item of entries) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const key = cleanText(record.key, 500);
    const factValue = cleanText(record.value, 4_000);
    if (!key || !factValue) continue;
    const dedupeKey = `${key.toLowerCase()}::${factValue.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const origin = ['captured', 'user-confirmed', 'ai-derived'].includes(String(record.origin))
      ? record.origin as BrandWorkspaceFact['origin']
      : defaultOrigin;
    result.push({
      key,
      value: factValue,
      origin,
      sourceSnapshotId: cleanId(record.sourceSnapshotId) || undefined,
      updatedAt: cleanText(record.updatedAt, 100) || nowIso(),
    });
  }
  return result.slice(0, 300);
}

function normalizeReviewSentiment(value: unknown): ProductReviewRecord['sentiment'] {
  return ['positive', 'neutral', 'negative'].includes(String(value))
    ? value as ProductReviewRecord['sentiment']
    : undefined;
}

function normalizeStoredReviewCapture(value: unknown): ProductReviewCapture | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const availableFilters: ProductReviewFilter[] = (Array.isArray(record.availableFilters) ? record.availableFilters : [])
    .flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const filter = item as Record<string, unknown>;
      const id = cleanId(filter.id);
      const label = cleanText(filter.label, 100);
      if (!id || !label) return [];
      return [{
        id,
        label,
        countText: cleanText(filter.countText, 100) || undefined,
        sentiment: normalizeReviewSentiment(filter.sentiment),
      }];
    }).slice(0, 50);
  const selectedFilters = (Array.isArray(record.selectedFilters) ? record.selectedFilters : [])
    .flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const filter = item as Record<string, unknown>;
      const id = cleanId(filter.id);
      const label = cleanText(filter.label, 100);
      if (!id || !label) return [];
      const rawLimit = Number(filter.limit);
      return [{
        id,
        label,
        limit: Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, Math.trunc(rawLimit))) : 5,
        captureAll: filter.captureAll === true || undefined,
      }];
    }).slice(0, 50);
  const results: ProductReviewResult[] = (Array.isArray(record.results) ? record.results : [])
    .flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const result = item as Record<string, unknown>;
      const filterId = cleanId(result.filterId);
      const label = cleanText(result.label, 100);
      if (!filterId || !label) return [];
      const status = ['complete', 'partial', 'missing'].includes(String(result.status))
        ? result.status as ProductReviewResult['status']
        : 'partial';
      return [{
        filterId,
        label,
        requested: Math.max(0, Math.trunc(Number(result.requested) || 0)),
        captured: Math.max(0, Math.trunc(Number(result.captured) || 0)),
        availableCount: typeof result.availableCount === 'number' && Number.isSafeInteger(result.availableCount) && result.availableCount >= 0 ? result.availableCount : undefined,
        status,
        warning: cleanText(result.warning, 500) || undefined,
        captureAll: result.captureAll === true || undefined,
      }];
    }).slice(0, 50);
  const reviews: ProductReviewRecord[] = (Array.isArray(record.reviews) ? record.reviews : [])
    .flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const review = item as Record<string, unknown>;
      const id = cleanId(review.id);
      const text = cleanReviewText(review.text);
      if (!id || !text) return [];
      const rating = Number(review.rating);
      const helpfulCount = Number(review.helpfulCount);
      const video = review.video && typeof review.video === 'object' && !Array.isArray(review.video)
        ? review.video as Record<string, unknown>
        : null;
      return [{
        id,
        platformReviewId: cleanId(review.platformReviewId) || undefined,
        authorName: cleanText(review.authorName, 300) || undefined,
        text,
        merchantReply: cleanReviewText(review.merchantReply) || undefined,
        rating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
        sentiment: normalizeReviewSentiment(review.sentiment),
        matchedFilterIds: cleanStringList(review.matchedFilterIds, 50).map(cleanId).filter(Boolean),
        ...splitProductReviewMetadata(review.dateText, review.skuText),
        badges: cleanStringList(review.badges, 20),
        helpfulCount: Number.isFinite(helpfulCount) && helpfulCount >= 0 ? Math.trunc(helpfulCount) : undefined,
        imageAssetIds: cleanStringList(review.imageAssetIds, 20).map(cleanId).filter(Boolean),
        sourceImages: (Array.isArray(review.sourceImages) ? review.sourceImages : [])
          .flatMap((image) => {
            if (!image || typeof image !== 'object' || Array.isArray(image)) return [];
            const sourceImage = image as Record<string, unknown>;
            const status = ['localized', 'failed', 'skipped'].includes(String(sourceImage.status))
              ? sourceImage.status as 'localized' | 'failed' | 'skipped'
              : undefined;
            return [{ sourceUrl: cleanText(sourceImage.sourceUrl, 8_000), status }];
          })
          .filter((image) => /^https?:\/\//i.test(image.sourceUrl))
          .slice(0, 20),
        video: video?.present === true ? {
          present: true as const,
          sourceUrl: cleanText(video.sourceUrl, 8_000) || undefined,
        } : undefined,
      }];
    });
  const status = ['not-opened', 'ready', 'complete', 'partial'].includes(String(record.status))
    ? record.status as ProductReviewCapture['status']
    : reviews.length ? 'partial' : 'not-opened';
  return {
    modalDetected: record.modalDetected === true,
    status,
    availableFilters,
    selectedFilters,
    results,
    reviews,
    warnings: cleanStringList(record.warnings, 100),
    activeFilterId: cleanId(record.activeFilterId) || undefined,
    sortText: cleanText(record.sortText, 100) || undefined,
    scopeText: cleanText(record.scopeText, 100) || undefined,
  };
}

function normalizeCatalog(value: unknown): BrandWorkspaceCatalog {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<BrandWorkspaceCatalog>
    : {};
  return {
    version: 1,
    brands: Array.isArray(source.brands) ? source.brands : [],
    products: Array.isArray(source.products)
      ? source.products.map((product) => ({ ...product, facts: normalizeFacts(product.facts) }))
      : [],
    skus: Array.isArray(source.skus) ? source.skus : [],
    assets: Array.isArray(source.assets) ? source.assets : [],
    sourceSnapshots: Array.isArray(source.sourceSnapshots)
      ? source.sourceSnapshots.map((snapshot) => ({
          ...snapshot,
          reviewCapture: normalizeStoredReviewCapture(snapshot.reviewCapture),
        }))
      : [],
    productLinks: Array.isArray(source.productLinks) ? source.productLinks.filter((link) => (
      link && Array.isArray(link.productIds) && link.productIds.length === 2 && link.productIds[0] !== link.productIds[1]
      && link.productIds.every((id) => source.products?.some((product) => product.id === id))
    )) : [],
    detailPages: Array.isArray(source.detailPages) ? source.detailPages : [],
  };
}

function selectReviewReferences(snapshots: ProductSourceSnapshot[], limit = 15): ProductReviewReference[] {
  const snapshot = snapshots.find((item) => (item.reviewCapture?.reviews.length || 0) > 0);
  if (!snapshot?.reviewCapture) return [];
  const capture = snapshot.reviewCapture;
  const filterLabels = new Map(capture.availableFilters.map((filter) => [filter.id, filter.label]));
  const orderedFilterIds = Array.from(new Set([
    ...capture.selectedFilters.map((filter) => filter.id),
    ...capture.reviews.flatMap((review) => review.matchedFilterIds),
  ])).filter(Boolean);
  const queues = orderedFilterIds.map((filterId) => capture.reviews.filter((review) => review.matchedFilterIds.includes(filterId)));
  const selected: ProductReviewRecord[] = [];
  const seen = new Set<string>();
  let queueIndex = 0;
  while (selected.length < limit && queues.some((queue) => queue.length > queueIndex)) {
    for (const queue of queues) {
      const review = queue[queueIndex];
      if (!review || seen.has(review.id)) continue;
      seen.add(review.id);
      selected.push(review);
      if (selected.length >= limit) break;
    }
    queueIndex += 1;
  }
  for (const review of capture.reviews) {
    if (selected.length >= limit) break;
    if (seen.has(review.id)) continue;
    seen.add(review.id);
    selected.push(review);
  }
  return selected.map((review) => ({
    id: review.id,
    authorName: review.authorName,
    text: cleanText(review.text, 500),
    rating: review.rating,
    sentiment: review.sentiment,
    matchedFilterIds: review.matchedFilterIds,
    filterLabels: Array.from(new Set(review.matchedFilterIds.map((id) => filterLabels.get(id)).filter(Boolean))) as string[],
    dateText: review.dateText,
    skuText: review.skuText,
    badges: review.badges,
    helpfulCount: review.helpfulCount,
    capturedAt: snapshot.capturedAt,
  }));
}

function safeFileName(value: unknown, fallback: string): string {
  const normalized = cleanText(value, 200)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/^\.+|\.+$/g, '');
  return normalized || fallback;
}

function dataUrlParts(dataUrl: string): { buffer: Buffer; extension: string } {
  const match = String(dataUrl || '').match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new Error('商品图片必须是 base64 图片');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`商品图片大小必须在 1 字节到 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 之间`);
  }
  const subtype = match[1].split('/')[1].toLowerCase();
  const extension = subtype.includes('png') ? 'png'
    : subtype.includes('webp') ? 'webp'
      : subtype.includes('gif') ? 'gif'
        : subtype.includes('avif') ? 'avif'
          : 'jpg';
  return { buffer, extension };
}

function pathExtension(value: string): string {
  const extension = path.extname(value).replace(/^\./, '').toLowerCase();
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'].includes(extension) ? extension : 'jpg';
}

export function createBrandWorkspaceStore(resolveRoot: () => string) {
  const operationRoot = new AsyncLocalStorage<string>();
  const rootProvider = () => operationRoot.getStore() || path.resolve(resolveRoot());
  const catalogPath = () => path.join(rootProvider(), 'catalog.json');
  const assetsRoot = () => path.join(rootProvider(), 'assets');

  async function readCatalog(): Promise<BrandWorkspaceCatalog> {
    try {
      return normalizeCatalog(JSON.parse(await fs.readFile(catalogPath(), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return normalizeCatalog(EMPTY_CATALOG);
      throw error;
    }
  }

  async function writeCatalog(catalog: BrandWorkspaceCatalog): Promise<void> {
    const root = rootProvider();
    const previous = await readCatalog();
    const signature = (source: BrandWorkspaceCatalog, id: string) => {
      const product = source.products.find((item) => item.id === id);
      const skus = source.skus.filter((item) => item.productId === id);
      const pages = source.detailPages.filter((item) => item.productId === id);
      const snapshots = source.sourceSnapshots.filter((item) => item.productId === id);
      const owners = new Set([id, ...skus.map((item) => item.id), ...pages.map((item) => item.id),
        ...snapshots.flatMap((item) => item.reviewCapture?.reviews.map((review) => review.id) || [])]);
      return JSON.stringify([product, source.brands.find((item) => item.id === product?.brandId), skus, pages, snapshots,
        source.assets.filter((item) => owners.has(item.ownerId))]);
    };
    const changes: ProductChange[] = [];
    for (const product of catalog.products) {
      const old = previous.products.find((item) => item.id === product.id);
      if (!old || signature(previous, product.id) !== signature(catalog, product.id)) {
        // Monotonic even for repeated captures with the same/older source timestamp.
        product.updatedAt = new Date(Math.max(Date.now(), (Date.parse(old?.updatedAt || '') || 0) + 1)).toISOString();
        changes.push({ root, productId: product.id, updatedAt: product.updatedAt, reason: 'product-updated' });
      }
    }
    for (const product of previous.products) {
      if (!catalog.products.some((item) => item.id === product.id)) changes.push({ root, productId: product.id, reason: 'product-deleted' });
    }
    await fs.mkdir(root, { recursive: true });
    const target = catalogPath();
    const temporary = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(catalog, null, 2), 'utf8');
    await fs.rename(temporary, target);
    for (const change of changes) {
      for (const listener of productEvents.listeners('changed')) {
        try { listener(change); }
        catch { console.warn('[BrandWorkspace] Product change listener failed; approvals will be reconciled on load.'); }
      }
    }
  }

  function publicAsset(asset: StoredAssetRef): BrandWorkspaceAssetRef {
    const absolutePath = path.join(rootProvider(), asset.relativePath);
    return {
      id: asset.id,
      ownerType: asset.ownerType,
      ownerId: asset.ownerId,
      path: toAppAssetUrl(absolutePath),
      absolutePath,
      sourceUrl: asset.sourceUrl,
      role: asset.role,
      origin: asset.origin,
      createdAt: asset.createdAt,
    };
  }

  async function createAsset(
    input: BrandWorkspaceImageInput,
    ownerType: StoredAssetRef['ownerType'],
    ownerId: string,
  ): Promise<StoredAssetRef | null> {
    const assetId = `asset_${Date.now()}_${randomUUID().slice(0, 8)}`;
    let buffer: Buffer | null = null;
    let extension = 'jpg';
    if (input.dataUrl) {
      const parsed = dataUrlParts(input.dataUrl);
      buffer = parsed.buffer;
      extension = parsed.extension;
    } else if (input.path) {
      try {
        const sourcePath = resolveAssetSourceToPath(input.path);
        const stat = await fs.stat(sourcePath);
        if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error('图片文件无效或过大');
        buffer = await fs.readFile(sourcePath);
        extension = pathExtension(sourcePath);
      } catch {
        return null;
      }
    }
    if (!buffer) return null;
    await fs.mkdir(assetsRoot(), { recursive: true });
    const fileName = safeFileName(`${assetId}-${input.name || 'image'}`, assetId);
    const relativePath = path.join('assets', `${fileName}.${extension}`).replace(/\\/g, '/');
    await fs.writeFile(path.join(rootProvider(), relativePath), buffer);
    return {
      id: assetId,
      ownerType,
      ownerId,
      relativePath,
      sourceUrl: cleanText(input.sourceUrl, 8_000) || undefined,
      role: cleanText(input.role, 100) || 'image',
      origin: input.origin === 'capture' || input.origin === 'generated' ? input.origin : 'user',
      createdAt: nowIso(),
    };
  }

  async function resolveAssets(
    catalog: BrandWorkspaceCatalog,
    inputs: BrandWorkspaceImageInput[] | undefined,
    ownerType: StoredAssetRef['ownerType'],
    ownerId: string,
  ): Promise<StoredAssetRef[]> {
    if (!Array.isArray(inputs)) return catalog.assets.filter((asset) => asset.ownerType === ownerType && asset.ownerId === ownerId);
    const resolved: StoredAssetRef[] = [];
    for (const input of inputs.slice(0, 100)) {
      const existing = input.id
        ? catalog.assets.find((asset) => asset.id === input.id && asset.ownerType === ownerType && asset.ownerId === ownerId)
        : input.sourceUrl
          ? [...catalog.assets].reverse().find((asset) => asset.ownerType === ownerType && asset.ownerId === ownerId && asset.sourceUrl === input.sourceUrl
            && (input.origin !== 'capture' || (asset.origin === 'capture' && !asset.excludedFromCreative)))
          : undefined;
      if (existing && !(input.origin === 'capture' && existing.origin === 'capture' && input.dataUrl && !await readCapturedAsset(existing))) {
        resolved.push(existing);
        continue;
      }
      // A fresh download must not be discarded in favor of a missing/corrupt
      // cached file. Keep the old historical reference, exclude it from creation.
      if (existing?.origin === 'capture') existing.excludedFromCreative = true;
      const created = await createAsset(input, ownerType, ownerId);
      if (created) resolved.push(created);
    }
    return Array.from(new Map(resolved.map((asset) => [asset.id, asset])).values());
  }

  async function readCapturedAsset(asset: StoredAssetRef): Promise<string | undefined> {
    if (asset.origin !== 'capture' || asset.excludedFromCreative) return undefined;
    const absolutePath = deletableAssetPath(asset);
    if (!absolutePath) return undefined;
    try {
      const stat = await fs.lstat(absolutePath);
      if (!stat.isFile() || stat.size <= 0 || stat.size > 12 * 1024 * 1024) return undefined;
      const realRoot = await fs.realpath(assetsRoot());
      const realPath = await fs.realpath(absolutePath);
      if (!realPath.startsWith(`${realRoot}${path.sep}`)) return undefined;
      const extension = path.extname(realPath).slice(1).toLowerCase();
      const mime = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
      const { contentType, buffer } = await readProductMedia(new Response(await fs.readFile(realPath), { headers: { 'content-type': mime } }));
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch { return undefined; }
  }

  async function getCapturedProductImageCache(input: CapturedProductInput) {
    const platform = validateProductCaptureIdentity(input.platform, input.externalId, input.sourceUrl);
    const catalog = await readCatalog();
    const snapshot = [...catalog.sourceSnapshots].reverse().find((item) => item.platform === platform && item.externalId === input.externalId);
    const cache = new Map<string, BrandWorkspaceImageInput>();
    if (!snapshot) return cache;
    const jobs = [
      ...(input.images || []).slice(0, 24).map((image) => ({ sourceUrl: image.sourceUrl, ownerType: 'product', ownerId: snapshot.productId, reviewId: undefined as string | undefined })),
      ...(input.reviewCapture?.reviews || []).flatMap((review) => (review.imageSourceUrls || []).map((sourceUrl) => ({
        sourceUrl, ownerType: 'product-review', ownerId: cleanId(`review-${platform}-${input.externalId}-${cleanId(review.id)}`), reviewId: review.id,
      }))).slice(0, 100),
    ];
    for (const job of jobs) {
      const sourceUrl = validateProductMediaSource(platform, job.sourceUrl);
      const asset = [...catalog.assets].reverse().find((item) => item.ownerType === job.ownerType && item.ownerId === job.ownerId
        && item.sourceUrl === sourceUrl && item.origin === 'capture' && !item.excludedFromCreative);
      const dataUrl = asset && await readCapturedAsset(asset);
      if (asset && dataUrl) cache.set(capturedMediaKey(sourceUrl, job.reviewId), { id: asset.id, sourceUrl, dataUrl, origin: 'capture' });
    }
    return cache;
  }

  function replaceOwnerAssets(catalog: BrandWorkspaceCatalog, ownerType: StoredAssetRef['ownerType'], ownerId: string, assets: StoredAssetRef[]): void {
    catalog.assets = [
      ...catalog.assets.filter((asset) => (
        asset.ownerType !== ownerType
        || asset.ownerId !== ownerId
      )),
      ...assets,
    ];
  }

  function deletableAssetPath(asset: StoredAssetRef): string | null {
    const assetRoot = path.resolve(assetsRoot());
    const absolutePath = path.resolve(rootProvider(), asset.relativePath);
    const relative = path.relative(assetRoot, absolutePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return absolutePath;
  }

  function productBundle(catalog: BrandWorkspaceCatalog, product: BrandWorkspaceProduct) {
    const skus = catalog.skus.filter((sku) => sku.productId === product.id);
    const detailPages = catalog.detailPages.filter((page) => page.productId === product.id);
    const sourceSnapshots = catalog.sourceSnapshots
      .filter((snapshot) => snapshot.productId === product.id)
      .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
    const reviewIds = new Set(sourceSnapshots.flatMap((snapshot) => snapshot.reviewCapture?.reviews.map((review) => review.id) || []));
    return {
      product,
      links: catalog.productLinks.filter((link) => link.productIds.includes(product.id)),
      skus,
      assets: catalog.assets.filter((asset) => asset.ownerType === 'product' && asset.ownerId === product.id).map(publicAsset),
      skuAssets: Object.fromEntries(skus.map((sku) => [
        sku.id,
        catalog.assets.filter((asset) => asset.ownerType === 'sku' && asset.ownerId === sku.id).map(publicAsset),
      ])),
      detailPages,
      detailPageAssets: Object.fromEntries(detailPages.map((page) => [
        page.id,
        catalog.assets.filter((asset) => asset.ownerType === 'product-detail' && asset.ownerId === page.id).map(publicAsset),
      ])),
      reviewAssets: catalog.assets.filter((asset) => asset.ownerType === 'product-review' && reviewIds.has(asset.ownerId)).map(publicAsset),
      sourceSnapshots,
    };
  }

  async function list() {
    const catalog = await readCatalog();
    const brands = [...catalog.brands];
    if (catalog.products.some((product) => !product.brandId)) {
      brands.push({
        id: UNASSIGNED_BRAND_ID,
        name: '待整理商品',
        description: '尚未归属品牌的采集商品',
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: nowIso(),
      });
    }
    return brands.map((brand) => ({
      brand,
      assets: brand.id === UNASSIGNED_BRAND_ID
        ? []
        : catalog.assets.filter((asset) => asset.ownerType === 'brand' && asset.ownerId === brand.id).map(publicAsset),
      products: catalog.products
        .filter((product) => (product.brandId || UNASSIGNED_BRAND_ID) === brand.id)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((product) => productBundle(catalog, product)),
    })).sort((left, right) => {
      if (left.brand.id === UNASSIGNED_BRAND_ID) return -1;
      if (right.brand.id === UNASSIGNED_BRAND_ID) return 1;
      return right.brand.updatedAt.localeCompare(left.brand.updatedAt);
    });
  }

  async function get(idInput: string) {
    const id = cleanId(idInput);
    const bundles = await list();
    const brand = bundles.find((bundle) => bundle.brand.id === id);
    if (brand) return { brand };
    for (const bundle of bundles) {
      const product = bundle.products.find((item) => item.product.id === id);
      if (product) return { brand: bundle, product };
    }
    throw new Error('品牌或商品不存在');
  }

  async function getProductAiReference(idInput: string) {
    const catalog = await readCatalog();
    const id = cleanId(idInput);
    const product = catalog.products.find((item) => item.id === id);
    if (!product) throw new Error('商品不存在');
    const sourceSnapshots = catalog.sourceSnapshots
      .filter((snapshot) => snapshot.productId === product.id)
      .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
    const brand = product.brandId
      ? catalog.brands.find((item) => item.id === product.brandId)
      : undefined;
    return {
      type: 'product-asset' as const,
      id: product.id,
      name: product.name,
      brandName: brand?.name || sourceSnapshots[0]?.brandName,
      description: product.description,
      audience: product.audience,
      usageScenarios: product.usageScenarios || [],
      brandStyle: product.brandStyle,
      facts: product.facts.map((fact) => ({
        key: fact.key,
        value: fact.value,
        origin: fact.origin,
      })),
      skus: catalog.skus
        .filter((sku) => sku.productId === product.id)
        .map((sku) => ({
          id: sku.id,
          name: sku.name,
          variantText: sku.variantText,
          externalId: sku.externalId,
        })),
      sources: sourceSnapshots.slice(0, 4).map((snapshot) => ({
        platform: snapshot.platform,
        sourceUrl: snapshot.sourceUrl,
        capturedAt: snapshot.capturedAt,
        externalId: snapshot.externalId,
        shopName: snapshot.shopName,
        price: snapshot.price,
        selectedSku: snapshot.selectedSku,
        parameters: snapshot.parameters,
        missingFields: snapshot.missingFields,
      })),
      imageCount: catalog.assets.filter((asset) => (
        asset.ownerType === 'product' && asset.ownerId === product.id && !asset.excludedFromCreative
      )).length,
      reviews: selectReviewReferences(sourceSnapshots),
    };
  }

  async function getProductCreativeReference(idInput: string): Promise<ProductCreativeReference> {
    const catalog = await readCatalog();
    const id = cleanId(idInput);
    const product = catalog.products.find((item) => item.id === id);
    if (!product) throw Object.assign(new Error('商品不存在'), { code: 'PRODUCT_NOT_FOUND' });
    const brand = product.brandId ? catalog.brands.find((item) => item.id === product.brandId) : undefined;
    const skus = catalog.skus.filter((sku) => sku.productId === product.id);
    const skuIds = new Set(skus.map((sku) => sku.id));
    const detailPageIds = new Set(catalog.detailPages.filter((page) => page.productId === product.id).map((page) => page.id));
    const storedAssets = catalog.assets.filter((asset) => !asset.excludedFromCreative && (
      (asset.ownerType === 'product' && asset.ownerId === product.id)
      || (asset.ownerType === 'sku' && skuIds.has(asset.ownerId))
      || (asset.ownerType === 'product-detail' && detailPageIds.has(asset.ownerId))
    ));
    const sources = catalog.sourceSnapshots
      .filter((snapshot) => snapshot.productId === product.id)
      .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
    return {
      type: 'product-creative-reference',
      id: product.id,
      name: product.name,
      updatedAt: product.updatedAt,
      productVersion: product.updatedAt,
      brandName: brand?.name || sources[0]?.brandName,
      description: product.description,
      audience: product.audience,
      usageScenarios: product.usageScenarios || [],
      brandStyle: product.brandStyle,
      facts: product.facts.map((fact) => ({ key: fact.key, value: fact.value, origin: fact.origin })),
      skus: skus.map((sku) => ({ id: sku.id, name: sku.name, variantText: sku.variantText, externalId: sku.externalId })),
      sources: sources.slice(0, 4).map((source) => ({
        platform: source.platform,
        sourceUrl: source.sourceUrl,
        capturedAt: source.capturedAt,
        price: source.price,
        parameters: source.parameters,
      })),
      reviews: selectReviewReferences(sources),
      assets: storedAssets.map((asset) => ({
        id: asset.id,
        role: asset.role,
        origin: asset.origin,
        previewUrl: toAppAssetUrl(path.join(rootProvider(), asset.relativePath)),
      })),
    };
  }

  async function resolveProductCreativeAssetPaths(idInput: string, assetIdsInput: string[]) {
    const catalog = await readCatalog();
    const id = cleanId(idInput);
    const product = catalog.products.find((item) => item.id === id);
    if (!product) throw new Error('商品不存在');
    const skuIds = new Set(catalog.skus.filter((sku) => sku.productId === product.id).map((sku) => sku.id));
    const detailPageIds = new Set(catalog.detailPages.filter((page) => page.productId === product.id).map((page) => page.id));
    const allowed = new Map(catalog.assets.filter((asset) => !asset.excludedFromCreative && (
      (asset.ownerType === 'product' && asset.ownerId === product.id)
      || (asset.ownerType === 'sku' && skuIds.has(asset.ownerId))
      || (asset.ownerType === 'product-detail' && detailPageIds.has(asset.ownerId))
    )).map((asset) => [asset.id, asset]));
    return Array.from(new Set(assetIdsInput.map(cleanId).filter(Boolean))).map((assetId) => {
      const asset = allowed.get(assetId);
      if (!asset) throw new Error(`商品素材不存在或不属于当前商品：${assetId}`);
      return { assetId, absolutePath: path.join(rootProvider(), asset.relativePath) };
    });
  }

  async function upsertBrand(input: {
    id?: string;
    name?: string;
    description?: string;
    images?: BrandWorkspaceImageInput[];
  }) {
    const catalog = await readCatalog();
    const name = cleanText(input.name, 500);
    if (!name) throw new Error('品牌名称不能为空');
    const id = cleanId(input.id) || `brand_${Date.now()}_${randomUUID().slice(0, 8)}`;
    if (id === UNASSIGNED_BRAND_ID) throw new Error('待整理商品不是可编辑品牌');
    const existing = catalog.brands.find((brand) => brand.id === id);
    const updatedAt = nowIso();
    const brand: BrandWorkspaceBrand = {
      id,
      name,
      description: cleanText(input.description, 4_000) || undefined,
      createdAt: existing?.createdAt || updatedAt,
      updatedAt,
    };
    catalog.brands = [...catalog.brands.filter((item) => item.id !== id), brand];
    const assets = await resolveAssets(catalog, input.images, 'brand', id);
    replaceOwnerAssets(catalog, 'brand', id, assets);
    await writeCatalog(catalog);
    return (await list()).find((bundle) => bundle.brand.id === id)!;
  }

  async function upsertProduct(input: {
    id?: string;
    brandId?: string;
    name?: string;
    description?: string;
    audience?: string;
    usageScenarios?: string[];
    brandStyle?: string;
    facts?: BrandWorkspaceFact[];
    images?: BrandWorkspaceImageInput[];
    skus?: Array<{
      id?: string;
      name?: string;
      variantText?: string;
      externalId?: string;
      images?: BrandWorkspaceImageInput[];
    }>;
  }) {
    const catalog = await readCatalog();
    const name = cleanText(input.name, 1_000);
    if (!name) throw new Error('商品名称不能为空');
    const requestedBrandId = cleanId(input.brandId);
    const brandId = requestedBrandId && requestedBrandId !== UNASSIGNED_BRAND_ID ? requestedBrandId : undefined;
    if (brandId && !catalog.brands.some((brand) => brand.id === brandId)) throw new Error('所属品牌不存在');
    const id = cleanId(input.id) || `product_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const existing = catalog.products.find((product) => product.id === id);
    const updatedAt = nowIso();
    const hasInputField = (field: keyof typeof input) => Object.prototype.hasOwnProperty.call(input, field);
    const product: BrandWorkspaceProduct = {
      id,
      brandId,
      name,
      description: cleanText(input.description, 20_000) || undefined,
      audience: hasInputField('audience') ? cleanText(input.audience, 4_000) || undefined : existing?.audience,
      usageScenarios: hasInputField('usageScenarios') ? cleanStringList(input.usageScenarios, 50) : existing?.usageScenarios,
      brandStyle: hasInputField('brandStyle') ? cleanText(input.brandStyle, 4_000) || undefined : existing?.brandStyle,
      facts: hasInputField('facts') ? normalizeFacts(input.facts) : existing?.facts || [],
      createdAt: existing?.createdAt || updatedAt,
      updatedAt,
      userEditedAt: updatedAt,
    };
    catalog.products = [...catalog.products.filter((item) => item.id !== id), product];
    const productAssets = await resolveAssets(catalog, input.images, 'product', id);
    replaceOwnerAssets(catalog, 'product', id, productAssets);

    if (Array.isArray(input.skus)) {
      const retainedSkuIds = new Set<string>();
      for (const skuInput of input.skus.slice(0, 200)) {
        const skuName = cleanText(skuInput.name, 1_000);
        if (!skuName) continue;
        const skuId = cleanId(skuInput.id) || `sku_${Date.now()}_${randomUUID().slice(0, 8)}`;
        retainedSkuIds.add(skuId);
        const existingSku = catalog.skus.find((sku) => sku.id === skuId);
        const sku: BrandWorkspaceSku = {
          id: skuId,
          productId: id,
          name: skuName,
          variantText: cleanText(skuInput.variantText, 4_000) || undefined,
          externalId: cleanId(skuInput.externalId) || existingSku?.externalId,
          createdAt: existingSku?.createdAt || updatedAt,
          updatedAt,
          userEditedAt: updatedAt,
        };
        catalog.skus = [...catalog.skus.filter((item) => item.id !== skuId), sku];
        const skuAssets = await resolveAssets(catalog, skuInput.images, 'sku', skuId);
        replaceOwnerAssets(catalog, 'sku', skuId, skuAssets);
      }
      const removedSkuIds = catalog.skus
        .filter((sku) => sku.productId === id && !retainedSkuIds.has(sku.id))
        .map((sku) => sku.id);
      catalog.skus = catalog.skus.filter((sku) => sku.productId !== id || retainedSkuIds.has(sku.id));
      catalog.assets = catalog.assets.filter((asset) => asset.ownerType !== 'sku' || !removedSkuIds.includes(asset.ownerId));
    }
    await writeCatalog(catalog);
    return productBundle(catalog, product);
  }

  async function upsertSku(input: {
    id?: string;
    productId?: string;
    name?: string;
    variantText?: string;
    externalId?: string;
    images?: BrandWorkspaceImageInput[];
  }) {
    const catalog = await readCatalog();
    const productId = cleanId(input.productId);
    if (!catalog.products.some((product) => product.id === productId)) throw new Error('商品不存在');
    const name = cleanText(input.name, 1_000);
    if (!name) throw new Error('SKU 名称不能为空');
    const id = cleanId(input.id) || `sku_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const existing = catalog.skus.find((sku) => sku.id === id);
    const updatedAt = nowIso();
    const sku: BrandWorkspaceSku = {
      id,
      productId,
      name,
      variantText: cleanText(input.variantText, 4_000) || undefined,
      externalId: cleanId(input.externalId) || existing?.externalId,
      createdAt: existing?.createdAt || updatedAt,
      updatedAt,
      userEditedAt: updatedAt,
    };
    catalog.skus = [...catalog.skus.filter((item) => item.id !== id), sku];
    const assets = await resolveAssets(catalog, input.images, 'sku', id);
    replaceOwnerAssets(catalog, 'sku', id, assets);
    await writeCatalog(catalog);
    return sku;
  }

  async function upsertProductDetailPage(input: {
    id?: string;
    productId?: string;
    platform?: string;
    market?: string;
    locale?: string;
    title?: string;
    images?: BrandWorkspaceImageInput[];
  }) {
    const catalog = await readCatalog();
    const productId = cleanId(input.productId);
    if (!catalog.products.some((product) => product.id === productId)) throw new Error('商品不存在');
    const platform = cleanId(input.platform);
    if (!platform) throw new Error('电商平台不能为空');
    const market = cleanText(input.market, 500);
    const locale = cleanText(input.locale, 500);
    const existing = cleanId(input.id)
      ? catalog.detailPages.find((page) => page.id === cleanId(input.id))
      : catalog.detailPages.find((page) => page.productId === productId && page.platform === platform && page.market === market && page.locale === locale);
    const id = existing?.id || `detail_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const updatedAt = nowIso();
    const page: BrandWorkspaceProductDetailPage = {
      id,
      productId,
      platform,
      market,
      locale,
      title: cleanText(input.title, 1_000) || undefined,
      createdAt: existing?.createdAt || updatedAt,
      updatedAt,
    };
    catalog.detailPages = [...catalog.detailPages.filter((item) => item.id !== id), page];
    const assets = await resolveAssets(catalog, input.images, 'product-detail', id);
    replaceOwnerAssets(catalog, 'product-detail', id, assets);
    await writeCatalog(catalog);
    return page;
  }

  async function deleteProduct(idInput: string) {
    const catalog = await readCatalog();
    const productId = cleanId(idInput);
    const product = catalog.products.find((item) => item.id === productId);
    if (!product) throw new Error('商品不存在');

    const skuIds = new Set(catalog.skus.filter((sku) => sku.productId === productId).map((sku) => sku.id));
    const detailPageIds = new Set(catalog.detailPages.filter((page) => page.productId === productId).map((page) => page.id));
    const snapshots = catalog.sourceSnapshots.filter((snapshot) => snapshot.productId === productId);
    const reviewIds = new Set(snapshots.flatMap((snapshot) => (
      snapshot.reviewCapture?.reviews.map((review) => review.id) || []
    )));
    const removedAssets = catalog.assets.filter((asset) => (
      (asset.ownerType === 'product' && asset.ownerId === productId)
      || (asset.ownerType === 'sku' && skuIds.has(asset.ownerId))
      || (asset.ownerType === 'product-detail' && detailPageIds.has(asset.ownerId))
      || (asset.ownerType === 'product-review' && reviewIds.has(asset.ownerId))
    ));

    catalog.products = catalog.products.filter((item) => item.id !== productId);
    catalog.productLinks = catalog.productLinks.filter((link) => !link.productIds.includes(productId));
    catalog.skus = catalog.skus.filter((sku) => sku.productId !== productId);
    catalog.detailPages = catalog.detailPages.filter((page) => page.productId !== productId);
    catalog.sourceSnapshots = catalog.sourceSnapshots.filter((snapshot) => snapshot.productId !== productId);
    const removedAssetIds = new Set(removedAssets.map((asset) => asset.id));
    catalog.assets = catalog.assets.filter((asset) => !removedAssetIds.has(asset.id));
    await writeCatalog(catalog);

    const fileDeleteFailures: string[] = [];
    for (const asset of removedAssets) {
      const absolutePath = deletableAssetPath(asset);
      if (!absolutePath) {
        fileDeleteFailures.push(asset.id);
        continue;
      }
      try {
        await fs.rm(absolutePath, { force: true });
      } catch {
        fileDeleteFailures.push(asset.id);
      }
    }

    return {
      productId,
      deletedSnapshots: snapshots.length,
      deletedSkus: skuIds.size,
      deletedDetailPages: detailPageIds.size,
      deletedReviews: reviewIds.size,
      deletedAssets: removedAssets.length - fileDeleteFailures.length,
      fileDeleteFailures,
    };
  }

  async function ingestProduct(input: CapturedProductInput) {
    const catalog = await readCatalog();
    const platform = cleanId(input.platform);
    const externalId = cleanId(input.externalId);
    const sourceUrl = cleanText(input.sourceUrl, 8_000);
    const title = cleanText(input.title, 1_000);
    if (!platform || !externalId || !title || !/^https?:\/\//i.test(sourceUrl)) {
      throw new Error('采集商品缺少平台、商品标识、名称或来源链接');
    }
    const previousSnapshot = [...catalog.sourceSnapshots]
      .reverse()
      .find((snapshot) => snapshot.platform === platform && snapshot.externalId === externalId);
    const existingProduct = previousSnapshot
      ? catalog.products.find((product) => product.id === previousSnapshot.productId)
      : undefined;
    const productId = existingProduct?.id || `product_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const capturedAt = cleanText(input.capturedAt, 100) || nowIso();
    const snapshotId = `source_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const parameters = (Array.isArray(input.parameters) ? input.parameters : [])
      .map((item) => ({ key: cleanText(item?.key, 500), value: cleanText(item?.value, 4_000) }))
      .filter((item) => item.key && item.value)
      .slice(0, 200);
    const capturedFacts = parameters.map((item) => ({
      ...item,
      origin: 'captured' as const,
      sourceSnapshotId: snapshotId,
      updatedAt: capturedAt,
    }));
    const product: BrandWorkspaceProduct = existingProduct
      ? {
          ...existingProduct,
          name: existingProduct.userEditedAt ? existingProduct.name : title,
          description: existingProduct.userEditedAt
            ? existingProduct.description
            : cleanLines(input.description || input.detailText, 20_000) || (input.description === '' ? undefined : existingProduct.description),
          facts: [
            ...existingProduct.facts.filter((fact) => fact.origin !== 'captured' || !capturedFacts.some((next) => next.key === fact.key)),
            ...capturedFacts.filter((fact) => !existingProduct.facts.some((prior) => prior.key === fact.key && prior.origin !== 'captured')),
          ],
          updatedAt: capturedAt,
        }
      : {
          id: productId,
          name: title,
          description: cleanLines(input.description || input.detailText, 20_000) || undefined,
          facts: capturedFacts,
          createdAt: capturedAt,
          updatedAt: capturedAt,
        };
    catalog.products = [...catalog.products.filter((item) => item.id !== productId), product];

    const priorProductAssets = catalog.assets.filter((asset) => asset.ownerType === 'product' && asset.ownerId === productId);
    for (const asset of priorProductAssets) {
      if (asset.origin === 'capture' && isProductCaptureUiImage(platform, asset.sourceUrl)) asset.excludedFromCreative = true;
    }
    const newProductAssets = await resolveAssets(catalog, (input.images || []).map((image) => ({
      ...image,
      origin: 'capture',
      role: image.role || 'image',
    })), 'product', productId);
    const productAssets = Array.from(new Map([...priorProductAssets, ...newProductAssets].map((asset) => [asset.id, asset])).values());
    replaceOwnerAssets(catalog, 'product', productId, productAssets);

    const selectedSkuName = cleanText(input.selectedSku?.name, 1_000);
    if (selectedSkuName) {
      const skuExternalId = cleanId(input.selectedSku?.externalId);
      const existingSku = catalog.skus.find((sku) => sku.productId === productId && (
        (skuExternalId && sku.externalId === skuExternalId)
        || sku.name === selectedSkuName
      ));
      const selectedVariant = cleanText(input.selectedSku?.variantText, 4_000) || undefined;
      // Repair only a malformed captured value proven to belong to this exact
      // source/SKU. Preserve manual edits, history and other products.
      const priorCapturedSku = existingSku && !existingSku.userEditedAt && !existingProduct?.userEditedAt
        && catalog.sourceSnapshots.some((snapshot) => snapshot.productId === productId && snapshot.platform === platform
          && snapshot.externalId === externalId && snapshot.capturedAt === existingSku.updatedAt
          && snapshot.selectedSku?.externalId === skuExternalId && snapshot.selectedSku?.name === existingSku.name
          && snapshot.selectedSku?.variantText === existingSku.variantText);
      const repairCapturedText = Boolean(priorCapturedSku && skuExternalId && existingSku?.externalId === skuExternalId
        && /\uFFFD/.test(`${existingSku?.name || ''}${existingSku?.variantText || ''}`)
        && !/\uFFFD/.test(`${selectedSkuName}${selectedVariant || ''}`)
        && !(input.missingFields || []).some((field) => field.startsWith('当前规格文字异常')));
      const skuId = existingSku?.id || `sku_${Date.now()}_${randomUUID().slice(0, 8)}`;
      catalog.skus = [
        ...catalog.skus.filter((sku) => sku.id !== skuId),
        {
          id: skuId,
          productId,
          name: repairCapturedText ? selectedSkuName : existingSku?.name || selectedSkuName,
          variantText: repairCapturedText ? selectedVariant : existingSku?.variantText || selectedVariant,
          externalId: existingSku?.externalId || skuExternalId || undefined,
          createdAt: existingSku?.createdAt || capturedAt,
          updatedAt: capturedAt,
          ...(existingSku?.userEditedAt ? { userEditedAt: existingSku.userEditedAt } : {}),
        },
      ];
    }

    const capturedReviews = Array.isArray(input.reviewCapture?.reviews) ? input.reviewCapture.reviews : [];
    const storedReviews: ProductReviewRecord[] = [];
    for (const capturedReview of capturedReviews) {
      const sourceReviewId = cleanId(capturedReview?.id);
      const text = cleanReviewText(capturedReview?.text);
      if (!sourceReviewId || !text) continue;
      const reviewId = cleanId(`review-${platform}-${externalId}-${sourceReviewId}`);
      const priorReviewAssets = catalog.assets.filter((asset) => asset.ownerType === 'product-review' && asset.ownerId === reviewId);
      const newReviewAssets = await resolveAssets(catalog, (capturedReview.images || []).map((image) => ({
        ...image,
        origin: 'capture',
        role: 'review-image',
      })), 'product-review', reviewId);
      const reviewAssets = Array.from(new Map([...priorReviewAssets, ...newReviewAssets].map((asset) => [asset.id, asset])).values());
      replaceOwnerAssets(catalog, 'product-review', reviewId, reviewAssets);
      const capturedSourceImages: NonNullable<ProductReviewRecord['sourceImages']> = capturedReview.sourceImages
        || capturedReview.imageSourceUrls?.map((sourceUrl) => ({ sourceUrl }))
        || [];
      const currentReviewSourceUrls = new Set(capturedSourceImages
        .map((image) => cleanText(image.sourceUrl, 8_000))
        .filter(Boolean));
      const rating = Number(capturedReview.rating);
      const helpfulCount = Number(capturedReview.helpfulCount);
      storedReviews.push({
        id: reviewId,
        platformReviewId: cleanId(capturedReview.platformReviewId) || undefined,
        authorName: cleanText(capturedReview.authorName, 300) || undefined,
        text,
        merchantReply: cleanReviewText(capturedReview.merchantReply) || undefined,
        rating: Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : undefined,
        sentiment: normalizeReviewSentiment(capturedReview.sentiment),
        matchedFilterIds: cleanStringList(capturedReview.matchedFilterIds, 50).map(cleanId).filter(Boolean),
        ...splitProductReviewMetadata(capturedReview.dateText, capturedReview.skuText),
        badges: cleanStringList(capturedReview.badges, 20),
        helpfulCount: Number.isFinite(helpfulCount) && helpfulCount >= 0 ? Math.trunc(helpfulCount) : undefined,
        imageAssetIds: reviewAssets.filter((asset) => !asset.excludedFromCreative && asset.sourceUrl && currentReviewSourceUrls.has(asset.sourceUrl)).map((asset) => asset.id),
        sourceImages: capturedSourceImages
          .map((image) => ({
            sourceUrl: cleanText(image.sourceUrl, 8_000),
            status: ['localized', 'failed', 'skipped'].includes(String(image.status)) ? image.status : undefined,
          }))
          .filter((image) => /^https?:\/\//i.test(image.sourceUrl))
          .slice(0, 20),
        video: capturedReview.video?.present === true ? {
          present: true,
          sourceUrl: cleanText(capturedReview.video.sourceUrl, 8_000) || undefined,
        } : undefined,
      });
    }
    const reviewCapture = input.reviewCapture ? normalizeStoredReviewCapture({
      ...input.reviewCapture,
      reviews: storedReviews,
    }) : undefined;

    const snapshot: ProductSourceSnapshot = {
      captureVersion: input.captureVersion === 2 || input.captureVersion === 3 ? input.captureVersion : undefined,
      id: snapshotId,
      productId,
      platform,
      externalId,
      sourceUrl,
      capturedAt,
      title,
      brandName: cleanText(input.brandName, 1_000) || undefined,
      shopName: cleanText(input.shopName, 1_000) || undefined,
      description: cleanLines(input.description, 20_000) || undefined,
      selectedSku: selectedSkuName ? {
        externalId: cleanId(input.selectedSku?.externalId) || undefined,
        name: selectedSkuName,
        variantText: cleanText(input.selectedSku?.variantText, 4_000) || undefined,
      } : undefined,
      price: cleanText(input.price?.text, 500) ? {
        text: cleanText(input.price?.text, 500),
        currency: cleanText(input.price?.currency, 50) || undefined,
        label: cleanText(input.price?.label, 100) || undefined,
      } : undefined,
      parameters,
      detailText: cleanLines(input.detailText, 50_000) || undefined,
      imageAssetIds: newProductAssets.map((asset) => asset.id),
      sourceImages: (input.sourceImages || input.images || []).slice(0, 24)
        .map((image) => ({ sourceUrl: cleanText(image.sourceUrl, 8_000), role: cleanText(image.role, 100) || 'gallery' }))
        .filter((image) => /^https?:\/\//i.test(image.sourceUrl)),
      reviewCapture,
      missingFields: cleanStringList(input.missingFields, 30),
    };
    catalog.sourceSnapshots = [...catalog.sourceSnapshots, snapshot]
      .filter((item, index, items) => items.length - index <= 2_000)
      .filter((item) => catalog.products.some((candidate) => candidate.id === item.productId));
    await writeCatalog(catalog);
    return {
      product: productBundle(catalog, product),
      sourceSnapshot: snapshot,
      duplicate: Boolean(existingProduct),
    };
  }

  async function linkProducts(input: LinkProductsInput): Promise<ProductLink> {
    const catalog = await readCatalog();
    const productId = cleanId(input.productId);
    const relatedProductId = cleanId(input.relatedProductId);
    if (!productId || !relatedProductId || productId === relatedProductId) throw new Error('请选择另一个商品');
    const product = catalog.products.find((item) => item.id === productId);
    const related = catalog.products.find((item) => item.id === relatedProductId);
    if (!product || !related) throw Object.assign(new Error('关联商品已不存在，请刷新'), { code: 'PRODUCT_NOT_FOUND' });
    if (product.updatedAt !== input.productVersion || related.updatedAt !== input.relatedProductVersion) {
      throw Object.assign(new Error('商品资料已变化，请刷新候选后确认'), { code: 'PRODUCT_LINK_STALE' });
    }
    const productIds = [productId, relatedProductId].sort() as [string, string];
    const existing = catalog.productLinks.find((link) => link.productIds[0] === productIds[0] && link.productIds[1] === productIds[1]);
    if (existing) return existing;
    const link: ProductLink = { id: `link_${randomUUID()}`, productIds, confirmedAt: nowIso(), reason: cleanText(input.reason, 2_000) || '用户确认同款' };
    catalog.productLinks.push(link);
    await writeCatalog(catalog);
    return link;
  }

  async function unlinkProducts(input: { productId: string; relatedProductId: string }): Promise<void> {
    const catalog = await readCatalog();
    const productId = cleanId(input.productId);
    const relatedProductId = cleanId(input.relatedProductId);
    if (!productId || !relatedProductId || productId === relatedProductId) throw new Error('关联商品标识无效');
    catalog.productLinks = catalog.productLinks.filter((link) => !(link.productIds.includes(productId) && link.productIds.includes(relatedProductId)));
    await writeCatalog(catalog);
  }

  async function rebuildAiIndex() {
    const catalog = await readCatalog();
    const payload = {
      version: 1,
      generatedAt: nowIso(),
      products: catalog.products.map((product) => ({
        id: product.id,
        brandId: product.brandId,
        name: product.name,
        description: product.description,
        audience: product.audience,
        usageScenarios: product.usageScenarios || [],
        brandStyle: product.brandStyle,
        facts: product.facts,
        skus: catalog.skus.filter((sku) => sku.productId === product.id),
        sources: catalog.sourceSnapshots.filter((snapshot) => snapshot.productId === product.id),
      })),
    };
    await fs.mkdir(rootProvider(), { recursive: true });
    await fs.writeFile(path.join(rootProvider(), 'ai-index.json'), JSON.stringify(payload, null, 2), 'utf8');
    return { productCount: payload.products.length, path: path.join(rootProvider(), 'ai-index.json') };
  }

  function enqueueMutation<T>(operation: () => Promise<T>, writes = false): Promise<T> {
    const root = path.resolve(resolveRoot());
    if (writes) pendingCatalogWrites.set(root, (pendingCatalogWrites.get(root) || 0) + 1);
    const previous = catalogQueues.get(root) || Promise.resolve();
    const result = previous.then(() => operationRoot.run(root, operation)).finally(() => {
      if (writes) {
        const remaining = (pendingCatalogWrites.get(root) || 1) - 1;
        if (remaining) pendingCatalogWrites.set(root, remaining);
        else pendingCatalogWrites.delete(root);
      }
    });
    const settled = result.then(() => undefined, () => undefined);
    catalogQueues.set(root, settled);
    void settled.then(() => { if (catalogQueues.get(root) === settled) catalogQueues.delete(root); });
    return result;
  }

  return {
    list: () => enqueueMutation(list),
    // Relationship-only writes serialize with the catalog, but do not invalidate creative snapshots.
    linkProducts: (input: LinkProductsInput) => enqueueMutation(() => linkProducts(input)),
    unlinkProducts: (input: { productId: string; relatedProductId: string }) => enqueueMutation(() => unlinkProducts(input)),
    get: (id: string) => enqueueMutation(() => get(id)),
    getCapturedProductImageCache: (input: CapturedProductInput) => enqueueMutation(() => getCapturedProductImageCache(input)),
    getProductAiReference: (id: string) => enqueueMutation(() => getProductAiReference(id)),
    getProductCreativeReference: (id: string) => enqueueMutation(() => getProductCreativeReference(id)),
    resolveProductCreativeAssetPaths: (id: string, assetIds: string[]) => enqueueMutation(() => resolveProductCreativeAssetPaths(id, assetIds)),
    withProductCreativeSnapshot: <T>(id: string, version: string, operation: (product: ProductCreativeReference, assets: Awaited<ReturnType<typeof resolveProductCreativeAssetPaths>>, assertCurrent: () => void) => Promise<T>) => enqueueMutation(async () => {
      const product = await getProductCreativeReference(id);
      const assertCurrent = () => {
        if (product.updatedAt !== version || pendingCatalogWrites.has(rootProvider())) {
          throw Object.assign(new Error('商品资料已更新或正在写入，请按最新资料重新规划'), { code: 'PRODUCT_SNAPSHOT_CHANGED' });
        }
      };
      assertCurrent();
      const assets = await resolveProductCreativeAssetPaths(id, product.assets.map((asset) => asset.id));
      // Protect source files while copying; a queued write must abort the unpublished snapshot.
      return operation(product, assets, assertCurrent);
    }),
    upsertBrand: (input: Parameters<typeof upsertBrand>[0]) => enqueueMutation(() => upsertBrand(input), true),
    upsertProduct: (input: Parameters<typeof upsertProduct>[0]) => enqueueMutation(() => upsertProduct(input), true),
    upsertSku: (input: Parameters<typeof upsertSku>[0]) => enqueueMutation(() => upsertSku(input), true),
    upsertProductDetailPage: (input: Parameters<typeof upsertProductDetailPage>[0]) => enqueueMutation(() => upsertProductDetailPage(input), true),
    deleteProduct: (id: string) => enqueueMutation(() => deleteProduct(id), true),
    ingestProduct: (input: CapturedProductInput) => enqueueMutation(() => ingestProduct(input), true),
    rebuildAiIndex: () => enqueueMutation(rebuildAiIndex),
    catalogExists: () => fsSync.existsSync(catalogPath()),
  };
}
