import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const INDEX_VERSION = 1;
const SEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const DEFAULT_TARGET_BYTES = 400 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const RETRY_DELAYS_MS = [0, 750, 2_000, 5_000] as const;

type ImageRecord = {
  url: string;
  file?: string;
  contentType?: string;
  bytes?: number;
  createdAt: number;
  lastAccess: number;
};

type SearchRecord = {
  imageIds: string[];
  updatedAt: number;
};

type CacheIndex = {
  version: 1;
  images: Record<string, ImageRecord>;
  searches: Record<string, SearchRecord>;
  sessions: Record<string, Record<string, string[]>>;
};

export type ImageOwner = {
  sessionId: string;
  callId: string;
};

export type CachedImage = {
  body: Buffer;
  contentType: string;
  etag: string;
};

export type ImageCacheStatus = {
  files: number;
  bytes: number;
  images: number;
  searches: number;
  sessions: number;
  root: string;
};

type ImageCacheOptions = {
  fetch?: typeof fetch;
  maxBytes?: number;
  targetBytes?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

function emptyIndex(): CacheIndex {
  return { version: INDEX_VERSION, images: {}, searches: {}, sessions: {} };
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("image URL must use HTTP(S)");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  }
  return url.toString();
}

function imageId(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function validOwnerPart(value: string): boolean {
  return value.length > 0 && value !== "undefined" && value !== "null";
}

function extension(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/avif") return "avif";
  return "jpg";
}

function isCacheIndex(value: unknown): value is CacheIndex {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CacheIndex>;
  return candidate.version === INDEX_VERSION
    && !!candidate.images && typeof candidate.images === "object"
    && !!candidate.searches && typeof candidate.searches === "object"
    && !!candidate.sessions && typeof candidate.sessions === "object";
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class ImageDiskCache {
  readonly root: string;
  readonly imagesDir: string;
  readonly indexPath: string;

  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly targetBytes: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly inflight = new Map<string, Promise<CachedImage>>();
  private index = emptyIndex();
  private ready: Promise<void> | undefined;
  private operations: Promise<void> = Promise.resolve();

  constructor(root: string, options: ImageCacheOptions = {}) {
    this.root = root;
    this.imagesDir = join(root, "images");
    this.indexPath = join(root, "index.json");
    this.fetchImpl = options.fetch ?? fetch;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.targetBytes = Math.min(options.targetBytes ?? DEFAULT_TARGET_BYTES, this.maxBytes);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  init(): Promise<void> {
    this.ready ??= this.initialize();
    return this.ready;
  }

  async cachedSearch(query: string): Promise<string[] | undefined> {
    await this.init();
    await this.operations;
    const key = query.trim();
    const record = this.index.searches[key];
    if (!record || this.now() - record.updatedAt > SEARCH_TTL_MS) return undefined;
    const ids = record.imageIds.filter((id) => this.index.images[id] !== undefined);
    return ids.length > 0 ? ids.map((id) => this.publicUrl(id)) : undefined;
  }

  async rememberSearch(query: string, urls: string[]): Promise<string[]> {
    await this.init();
    return this.mutate(async () => {
      const now = this.now();
      const ids: string[] = [];
      for (const value of urls) {
        const url = normalizeUrl(value);
        const id = imageId(url);
        if (!this.index.images[id]) this.index.images[id] = { url, createdAt: now, lastAccess: now };
        if (!ids.includes(id)) ids.push(id);
      }
      if (ids.length > 0) this.index.searches[query.trim()] = { imageIds: ids, updatedAt: now };
      await this.persist();
      return ids.map((id) => this.publicUrl(id));
    });
  }

  async registerSource(value: string): Promise<string> {
    await this.init();
    return this.mutate(async () => {
      const url = normalizeUrl(value);
      const id = imageId(url);
      const now = this.now();
      this.index.images[id] ??= { url, createdAt: now, lastAccess: now };
      await this.persist();
      return this.publicUrl(id);
    });
  }

  async image(id: string, owner?: ImageOwner): Promise<CachedImage | undefined> {
    await this.init();
    await this.operations;
    if (!this.index.images[id]) return undefined;

    let request = this.inflight.get(id);
    if (!request) {
      request = this.load(id).finally(() => this.inflight.delete(id));
      this.inflight.set(id, request);
    }
    const loaded = await request;
    await this.mutate(async () => {
      const record = this.index.images[id];
      if (record) record.lastAccess = this.now();
      if (owner && validOwnerPart(owner.sessionId) && validOwnerPart(owner.callId)) this.retain(owner, id);
      await this.enforceLimit(id);
      await this.persist();
    });
    return loaded;
  }

  async releaseSession(sessionId: string): Promise<void> {
    await this.init();
    await this.mutate(async () => {
      const calls = this.index.sessions[sessionId];
      if (!calls) return;
      const released = new Set(Object.values(calls).flat());
      delete this.index.sessions[sessionId];
      const referenced = this.referencedImageIds();
      for (const id of released) {
        if (!referenced.has(id)) await this.evictFile(id);
      }
      await this.persist();
    });
  }

  async clear(): Promise<void> {
    await this.init();
    await this.mutate(async () => {
      await rm(this.imagesDir, { recursive: true, force: true });
      await mkdir(this.imagesDir, { recursive: true });
      this.index = emptyIndex();
      await this.persist();
    });
  }

  async status(): Promise<ImageCacheStatus> {
    await this.init();
    await this.operations;
    const records = Object.values(this.index.images).filter((record) => record.file);
    return {
      files: records.length,
      bytes: records.reduce((sum, record) => sum + (record.bytes ?? 0), 0),
      images: Object.keys(this.index.images).length,
      searches: Object.keys(this.index.searches).length,
      sessions: Object.keys(this.index.sessions).length,
      root: this.root,
    };
  }

  private publicUrl(id: string): string {
    return `/openui/api/image/${id}`;
  }

  private async initialize(): Promise<void> {
    await mkdir(this.imagesDir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.indexPath, "utf8")) as unknown;
      if (isCacheIndex(parsed)) this.index = parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    await this.repair();
    await this.enforceLimit();
    await this.persist();
  }

  private async repair(): Promise<void> {
    const files = new Set(await readdir(this.imagesDir));
    const expected = new Set<string>();
    for (const record of Object.values(this.index.images)) {
      if (!record.file) continue;
      if (files.has(record.file)) expected.add(record.file);
      else {
        delete record.file;
        delete record.contentType;
        delete record.bytes;
      }
    }
    for (const file of files) {
      if (!expected.has(file)) await rm(join(this.imagesDir, file), { force: true });
    }

    const known = new Set(Object.keys(this.index.images));
    for (const [sessionId, calls] of Object.entries(this.index.sessions)) {
      if (!validOwnerPart(sessionId)) {
        delete this.index.sessions[sessionId];
        continue;
      }
      for (const [callId, ids] of Object.entries(calls)) {
        if (!validOwnerPart(callId)) {
          delete calls[callId];
          continue;
        }
        const kept = ids.filter((id) => known.has(id));
        if (kept.length > 0) calls[callId] = [...new Set(kept)];
        else delete calls[callId];
      }
      if (Object.keys(calls).length === 0) delete this.index.sessions[sessionId];
    }
    for (const [query, search] of Object.entries(this.index.searches)) {
      search.imageIds = search.imageIds.filter((id) => known.has(id));
      if (search.imageIds.length === 0 || this.now() - search.updatedAt > SEARCH_TTL_MS) delete this.index.searches[query];
    }
  }

  private async load(id: string): Promise<CachedImage> {
    const record = this.index.images[id]!;
    if (record.file && record.contentType) {
      try {
        return { body: await readFile(join(this.imagesDir, record.file)), contentType: record.contentType, etag: id };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    const downloaded = await this.download(record.url);
    const file = `${id}.${extension(downloaded.contentType)}`;
    const temporary = join(this.imagesDir, `${id}.${process.pid}.${this.now()}.tmp`);
    await writeFile(temporary, downloaded.body);
    await rename(temporary, join(this.imagesDir, file));
    await this.mutate(async () => {
      const current = this.index.images[id];
      if (!current) return;
      current.file = file;
      current.contentType = downloaded.contentType;
      current.bytes = downloaded.body.byteLength;
      current.lastAccess = this.now();
      await this.persist();
    });
    return { ...downloaded, etag: id };
  }

  private async download(url: string): Promise<Omit<CachedImage, "etag">> {
    let lastError: unknown;
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
      if (RETRY_DELAYS_MS[attempt] > 0) await this.sleep(RETRY_DELAYS_MS[attempt]);
      try {
        const response = await this.fetchImpl(url, {
          headers: { "User-Agent": "dsh-intelligent-ui/0.1" },
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 404 || response.status === 410) throw Object.assign(new Error(`image ${response.status}`), { permanent: true });
        if (!response.ok) throw new Error(`image ${response.status}`);
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        if (!contentType.startsWith("image/")) throw Object.assign(new Error(`unexpected image content type ${contentType || "unknown"}`), { permanent: true });
        const declared = Number(response.headers.get("content-length") ?? 0);
        if (declared > MAX_IMAGE_BYTES) throw Object.assign(new Error("image is larger than 20 MB"), { permanent: true });
        const body = Buffer.from(await response.arrayBuffer());
        if (body.byteLength > MAX_IMAGE_BYTES) throw Object.assign(new Error("image is larger than 20 MB"), { permanent: true });
        return { body, contentType };
      } catch (error) {
        lastError = error;
        if ((error as { permanent?: boolean }).permanent) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private retain(owner: ImageOwner, id: string): void {
    const session = this.index.sessions[owner.sessionId] ??= {};
    const images = session[owner.callId] ??= [];
    if (!images.includes(id)) images.push(id);
  }

  private referencedImageIds(): Set<string> {
    const referenced = new Set<string>();
    for (const calls of Object.values(this.index.sessions)) {
      for (const ids of Object.values(calls)) ids.forEach((id) => referenced.add(id));
    }
    return referenced;
  }

  private async enforceLimit(protectedId?: string): Promise<void> {
    const referenced = this.referencedImageIds();
    const candidates = Object.entries(this.index.images)
      .filter(([id, record]) => id !== protectedId && record.file)
      .sort(([idA, a], [idB, b]) => {
        const referenceOrder = Number(referenced.has(idA)) - Number(referenced.has(idB));
        return referenceOrder || a.lastAccess - b.lastAccess;
      });
    let total = Object.values(this.index.images).reduce((sum, record) => sum + (record.file ? record.bytes ?? 0 : 0), 0);
    if (total <= this.maxBytes) return;
    for (const [id, record] of candidates) {
      total -= record.bytes ?? 0;
      await this.evictFile(id);
      if (total <= this.targetBytes) break;
    }
  }

  private async evictFile(id: string): Promise<void> {
    const record = this.index.images[id];
    if (!record?.file) return;
    await rm(join(this.imagesDir, basename(record.file)), { force: true });
    delete record.file;
    delete record.contentType;
    delete record.bytes;
  }

  private async persist(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const temporary = `${this.indexPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.index, null, 2)}\n`, "utf8");
    await rename(temporary, this.indexPath);
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation);
    this.operations = result.then(() => undefined, () => undefined);
    return result;
  }
}
