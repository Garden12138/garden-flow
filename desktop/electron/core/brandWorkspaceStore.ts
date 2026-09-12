import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { resolveAssetSourceToPath, toAppAssetUrl } from './localAssetManager.ts';

export const UNASSIGNED_BRAND_ID = 'brand_unassigned';

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
};

type StoredAssetRef = {
  id: string;
  ownerType: 'brand' | 'product' | 'sku' | 'product-detail';
  ownerId: string;
  relativePath: string;
  sourceUrl?: string;
  role: string;
  origin: 'user' | 'capture' | 'generated';
  createdAt: string;
};

export type BrandWorkspaceAssetRef = Omit<StoredAssetRef, 'relativePath'> & {
  path: string;
  absolutePath: string;
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
  missingFields?: string[];
};

const EMPTY_CATALOG: BrandWorkspaceCatalog = {
  version: 1,
  brands: [],
  products: [],
  skus: [],
  assets: [],
  sourceSnapshots: [],
  detailPages: [],
};

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function nowIso(): string {
  return new Date().toISOString();
}

function cleanText(value: unknown, maxLength = 20_000): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
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
    sourceSnapshots: Array.isArray(source.sourceSnapshots) ? source.sourceSnapshots : [],
    detailPages: Array.isArray(source.detailPages) ? source.detailPages : [],
  };
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

export function createBrandWorkspaceStore(rootProvider: () => string) {
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
    await fs.mkdir(root, { recursive: true });
    const target = catalogPath();
    const temporary = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(catalog, null, 2), 'utf8');
    await fs.rename(temporary, target);
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
        ? catalog.assets.find((asset) => asset.id === input.id)
        : input.sourceUrl
          ? catalog.assets.find((asset) => asset.ownerType === ownerType && asset.ownerId === ownerId && asset.sourceUrl === input.sourceUrl)
          : undefined;
      if (existing) {
        resolved.push(existing);
        continue;
      }
      const created = await createAsset(input, ownerType, ownerId);
      if (created) resolved.push(created);
    }
    return Array.from(new Map(resolved.map((asset) => [asset.id, asset])).values());
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

  function productBundle(catalog: BrandWorkspaceCatalog, product: BrandWorkspaceProduct) {
    const skus = catalog.skus.filter((sku) => sku.productId === product.id);
    const detailPages = catalog.detailPages.filter((page) => page.productId === product.id);
    return {
      product,
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
      sourceSnapshots: catalog.sourceSnapshots
        .filter((snapshot) => snapshot.productId === product.id)
        .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt)),
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
            : cleanLines(input.description || input.detailText, 20_000) || existingProduct.description,
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
      const skuId = existingSku?.id || `sku_${Date.now()}_${randomUUID().slice(0, 8)}`;
      catalog.skus = [
        ...catalog.skus.filter((sku) => sku.id !== skuId),
        {
          id: skuId,
          productId,
          name: existingSku?.name || selectedSkuName,
          variantText: existingSku?.variantText || cleanText(input.selectedSku?.variantText, 4_000) || undefined,
          externalId: existingSku?.externalId || skuExternalId || undefined,
          createdAt: existingSku?.createdAt || capturedAt,
          updatedAt: capturedAt,
        },
      ];
    }

    const snapshot: ProductSourceSnapshot = {
      captureVersion: input.captureVersion === 2 ? 2 : undefined,
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

  let mutationQueue: Promise<void> = Promise.resolve();
  function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  return {
    list: async () => {
      await mutationQueue;
      return list();
    },
    get: async (id: string) => {
      await mutationQueue;
      return get(id);
    },
    upsertBrand: (input: Parameters<typeof upsertBrand>[0]) => enqueueMutation(() => upsertBrand(input)),
    upsertProduct: (input: Parameters<typeof upsertProduct>[0]) => enqueueMutation(() => upsertProduct(input)),
    upsertSku: (input: Parameters<typeof upsertSku>[0]) => enqueueMutation(() => upsertSku(input)),
    upsertProductDetailPage: (input: Parameters<typeof upsertProductDetailPage>[0]) => enqueueMutation(() => upsertProductDetailPage(input)),
    ingestProduct: (input: CapturedProductInput) => enqueueMutation(() => ingestProduct(input)),
    rebuildAiIndex: () => enqueueMutation(rebuildAiIndex),
    catalogExists: () => fsSync.existsSync(catalogPath()),
  };
}
