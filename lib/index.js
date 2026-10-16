// src/host/index.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool } from "@deepseek-ai/dsh-tools";

// src/host/image-cache.ts
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
var INDEX_VERSION = 1;
var SEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
var DEFAULT_TARGET_BYTES = 400 * 1024 * 1024;
var MAX_IMAGE_BYTES = 20 * 1024 * 1024;
var RETRY_DELAYS_MS = [0, 750, 2e3, 5e3];
function emptyIndex() {
  return { version: INDEX_VERSION, images: {}, searches: {}, sessions: {} };
}
function normalizeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("image URL must use HTTP(S)");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  }
  return url.toString();
}
function imageId(url) {
  return createHash("sha256").update(url).digest("hex");
}
function validOwnerPart(value) {
  return value.length > 0 && value !== "undefined" && value !== "null";
}
function extension(contentType) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/avif") return "avif";
  return "jpg";
}
function isCacheIndex(value) {
  if (!value || typeof value !== "object") return false;
  const candidate = value;
  return candidate.version === INDEX_VERSION && !!candidate.images && typeof candidate.images === "object" && !!candidate.searches && typeof candidate.searches === "object" && !!candidate.sessions && typeof candidate.sessions === "object";
}
var defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
var ImageDiskCache = class {
  root;
  imagesDir;
  indexPath;
  fetchImpl;
  maxBytes;
  targetBytes;
  now;
  sleep;
  inflight = /* @__PURE__ */ new Map();
  index = emptyIndex();
  ready;
  operations = Promise.resolve();
  constructor(root, options = {}) {
    this.root = root;
    this.imagesDir = join(root, "images");
    this.indexPath = join(root, "index.json");
    this.fetchImpl = options.fetch ?? fetch;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.targetBytes = Math.min(options.targetBytes ?? DEFAULT_TARGET_BYTES, this.maxBytes);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }
  init() {
    this.ready ??= this.initialize();
    return this.ready;
  }
  async cachedSearch(query2) {
    await this.init();
    await this.operations;
    const key = query2.trim();
    const record = this.index.searches[key];
    if (!record || this.now() - record.updatedAt > SEARCH_TTL_MS) return void 0;
    const ids = record.imageIds.filter((id) => this.index.images[id] !== void 0);
    return ids.length > 0 ? ids.map((id) => this.publicUrl(id)) : void 0;
  }
  async rememberSearch(query2, urls) {
    await this.init();
    return this.mutate(async () => {
      const now = this.now();
      const ids = [];
      for (const value of urls) {
        const url = normalizeUrl(value);
        const id = imageId(url);
        if (!this.index.images[id]) this.index.images[id] = { url, createdAt: now, lastAccess: now };
        if (!ids.includes(id)) ids.push(id);
      }
      if (ids.length > 0) this.index.searches[query2.trim()] = { imageIds: ids, updatedAt: now };
      await this.persist();
      return ids.map((id) => this.publicUrl(id));
    });
  }
  async registerSource(value) {
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
  async image(id, owner) {
    await this.init();
    await this.operations;
    if (!this.index.images[id]) return void 0;
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
  async releaseSession(sessionId) {
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
  async clear() {
    await this.init();
    await this.mutate(async () => {
      await rm(this.imagesDir, { recursive: true, force: true });
      await mkdir(this.imagesDir, { recursive: true });
      this.index = emptyIndex();
      await this.persist();
    });
  }
  async status() {
    await this.init();
    await this.operations;
    const records = Object.values(this.index.images).filter((record) => record.file);
    return {
      files: records.length,
      bytes: records.reduce((sum, record) => sum + (record.bytes ?? 0), 0),
      images: Object.keys(this.index.images).length,
      searches: Object.keys(this.index.searches).length,
      sessions: Object.keys(this.index.sessions).length,
      root: this.root
    };
  }
  publicUrl(id) {
    return `/openui/api/image/${id}`;
  }
  async initialize() {
    await mkdir(this.imagesDir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.indexPath, "utf8"));
      if (isCacheIndex(parsed)) this.index = parsed;
    } catch (error) {
      const code = error.code;
      if (code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    await this.repair();
    await this.enforceLimit();
    await this.persist();
  }
  async repair() {
    const files = new Set(await readdir(this.imagesDir));
    const expected = /* @__PURE__ */ new Set();
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
    for (const [query2, search] of Object.entries(this.index.searches)) {
      search.imageIds = search.imageIds.filter((id) => known.has(id));
      if (search.imageIds.length === 0 || this.now() - search.updatedAt > SEARCH_TTL_MS) delete this.index.searches[query2];
    }
  }
  async load(id) {
    const record = this.index.images[id];
    if (record.file && record.contentType) {
      try {
        return { body: await readFile(join(this.imagesDir, record.file)), contentType: record.contentType, etag: id };
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
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
  async download(url) {
    let lastError;
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
      if (RETRY_DELAYS_MS[attempt] > 0) await this.sleep(RETRY_DELAYS_MS[attempt]);
      try {
        const response = await this.fetchImpl(url, {
          headers: { "User-Agent": "dsh-openui/0.1" },
          signal: AbortSignal.timeout(1e4)
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
        if (error.permanent) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  retain(owner, id) {
    const session = this.index.sessions[owner.sessionId] ??= {};
    const images = session[owner.callId] ??= [];
    if (!images.includes(id)) images.push(id);
  }
  referencedImageIds() {
    const referenced = /* @__PURE__ */ new Set();
    for (const calls of Object.values(this.index.sessions)) {
      for (const ids of Object.values(calls)) ids.forEach((id) => referenced.add(id));
    }
    return referenced;
  }
  async enforceLimit(protectedId) {
    const referenced = this.referencedImageIds();
    const candidates = Object.entries(this.index.images).filter(([id, record]) => id !== protectedId && record.file).sort(([idA, a], [idB, b]) => {
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
  async evictFile(id) {
    const record = this.index.images[id];
    if (!record?.file) return;
    await rm(join(this.imagesDir, basename(record.file)), { force: true });
    delete record.file;
    delete record.contentType;
    delete record.bytes;
  }
  async persist() {
    await mkdir(this.root, { recursive: true });
    const temporary = `${this.indexPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.index, null, 2)}
`, "utf8");
    await rename(temporary, this.indexPath);
  }
  mutate(operation) {
    const result = this.operations.then(operation);
    this.operations = result.then(() => void 0, () => void 0);
    return result;
  }
};

// src/host/index.ts
var name = "dsh-openui";
var inject = ["tools", "systemPrompt", "webServer", "clientModules"];
var wikiCache = /* @__PURE__ */ new Map();
var routeCache = /* @__PURE__ */ new Map();
var headers = { "User-Agent": "dsh-openui/0.1" };
var skipImage = /\.svg|icon|logo|map|flag|seal|coat_of_arms|signature|diagram/i;
var bundleDir = dirname(fileURLToPath(import.meta.url));
var imageCacheRoot = () => process.env.DSH_OPENUI_CACHE_DIR ?? join2(homedir(), ".dsh", "dsh-openui", "image-cache");
var promptPath = join2(bundleDir, "..", "generated", "system-prompt.txt");
var mapWorker = readFileSync(join2(bundleDir, "maplibre-gl-worker.mjs"), "utf8");
var generatedPrompt = readFileSync(promptPath, "utf8").replace(
  /^You are an AI assistant that responds using openui-lang, a declarative UI language\. Your ENTIRE response must be valid openui-lang code — no markdown, no explanations, just openui-lang\.$/m,
  "The render_openui program must be valid openui-lang code: no markdown or explanations inside the program string."
);
var guidance = `Use render_openui when an interactive or visual answer materially improves the result: comparisons, plans, calculators, charts, checklists, step-by-step guides, diagrams, small games, forms, or exploratory interfaces. For ordinary prose, code, terminal work, and short factual answers, respond normally without this tool.

When you use render_openui, it is the complete final answer and ends the current turn. Call it once. Put every user-facing part of the answer in the program argument and a short visible label in title. Do not write prose before or after the tool call. Do not add audit notes, verification notes, caveats, source summaries, or implementation commentary unless the user explicitly asks for them; when requested, place them inside the interface.

${generatedPrompt}`;
function json(res, value, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", status >= 400 ? "no-store" : "public, max-age=3600");
  res.end(JSON.stringify(value));
}
async function get(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8e3) });
  if (response.status === 404) return {};
  if (!response.ok) throw new Error(`Wikipedia ${response.status}`);
  return response.json();
}
async function wiki(title) {
  const cached = wikiCache.get(title);
  if (cached) return cached;
  const slug = encodeURIComponent(title.replace(/ /g, "_"));
  const [summary, media] = await Promise.all([
    get(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`),
    get(`https://en.wikipedia.org/api/rest_v1/page/media-list/${slug}`)
  ]);
  const photos = [];
  const key = (url) => decodeURIComponent(url.split("?")[0].split("/").at(-1)).replace(/^\d+px-/, "");
  if (summary.thumbnail?.source) photos.push(summary.thumbnail.source);
  for (const item of media.items ?? []) {
    if (item.type !== "image" || !item.srcset?.length) continue;
    const source = item.srcset[0].src;
    if (skipImage.test(source)) continue;
    const url = source.startsWith("//") ? `https:${source}` : source;
    if (!photos.some((photo) => key(photo) === key(url))) photos.push(url);
    if (photos.length === 3) break;
  }
  const info = { lat: summary.coordinates?.lat, lng: summary.coordinates?.lon, photos };
  wikiCache.set(title, info);
  return info;
}
async function query(host, params) {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params })}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8e3) });
  if (!response.ok) throw new Error(`${host} ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`${host} error`);
  return (data.query?.pages ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}
var words = (text) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 3);
async function findRemoteImages(search) {
  const images = [];
  const add = (url) => {
    if (url?.startsWith("https://") && !skipImage.test(url) && !images.includes(url)) images.push(url);
  };
  const wanted = new Set(words(search));
  const articles = await query("en.wikipedia.org", {
    generator: "search",
    gsrsearch: search,
    gsrlimit: "6",
    prop: "pageimages",
    piprop: "thumbnail",
    pithumbsize: "960"
  });
  articles.filter((page) => words(page.title ?? "").some((word) => wanted.has(word))).forEach((page) => add(page.thumbnail?.source));
  const terms = search.split(/\s+/);
  for (const candidate of /* @__PURE__ */ new Set([terms.join(" "), terms.slice(0, 3).join(" "), terms.slice(0, 2).join(" ")])) {
    if (images.length >= 3) break;
    const files = await query("commons.wikimedia.org", {
      generator: "search",
      gsrsearch: `${candidate} filetype:bitmap`,
      gsrnamespace: "6",
      gsrlimit: "6",
      prop: "imageinfo",
      iiprop: "url|mime",
      iiurlwidth: "960"
    });
    files.forEach((page) => {
      const info = page.imageinfo?.[0];
      if (info?.mime?.startsWith("image/")) add(info.thumburl ?? info.url);
    });
  }
  return images.slice(0, 4);
}
async function streetRoute(coords) {
  const cached = routeCache.get(coords);
  if (cached) return cached;
  const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`, {
    headers,
    signal: AbortSignal.timeout(1e4)
  });
  if (!response.ok) throw new Error(`OSRM ${response.status}`);
  const data = await response.json();
  const coordinates = data.routes?.[0]?.geometry?.coordinates ?? [];
  if (data.code !== "Ok" || coordinates.length < 2) throw new Error("No street route");
  const route = coordinates.map(([lng, lat]) => [lat, lng]);
  routeCache.set(coords, route);
  return route;
}
function registerRoutes(ctx, imageCache) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/openui/status",
    async handler(_req, res) {
      const entry = ctx.clientModules.graph().entries.find((item) => item.id === "dsh-openui");
      json(res, {
        plugin: name,
        clientModule: entry,
        clientPath: ctx.clientModules.clientPath("dsh-openui"),
        imageCache: await imageCache.status()
      });
    }
  }), "dsh-openui: status route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/openui/maplibre-gl-worker.mjs",
    async handler(_req, res) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.end(mapWorker);
    }
  }), "dsh-openui: MapLibre worker");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/openui/api/wiki",
    async handler(req, res) {
      const title = new URL(req.url, "http://localhost").searchParams.get("title").trim();
      const info = await wiki(title);
      json(res, { ...info, photos: await imageCache.rememberSearch(`wiki:${title}`, info.photos) });
    }
  }), "dsh-openui: wiki image route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/openui/api/image-search",
    async handler(req, res) {
      const search = new URL(req.url, "http://localhost").searchParams.get("q").replace(/\s+/g, " ").trim();
      const cached = await imageCache.cachedSearch(search);
      if (cached) {
        json(res, { images: cached });
        return;
      }
      const [exact, found] = await Promise.all([
        wiki(search).catch(() => ({ photos: [] })),
        findRemoteImages(search).catch(() => [])
      ]);
      const urls = [.../* @__PURE__ */ new Set([...exact.photos, ...found])].slice(0, 4);
      json(res, { images: await imageCache.rememberSearch(search, urls) });
    }
  }), "dsh-openui: image search route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/openui/api/image-source",
    async handler(req, res) {
      const source = new URL(req.url, "http://localhost").searchParams.get("url");
      json(res, { image: await imageCache.registerSource(source) });
    }
  }), "dsh-openui: image source route");
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/openui/api/image",
    async handler(req, res) {
      const requestUrl = new URL(req.url, "http://localhost");
      const id = requestUrl.pathname.slice("/openui/api/image/".length);
      if (!/^[a-f0-9]{64}$/.test(id)) {
        json(res, { error: "unknown image" }, 404);
        return;
      }
      try {
        const sessionId = requestUrl.searchParams.get("sessionId") ?? "";
        const callId = requestUrl.searchParams.get("callId") ?? "";
        const image = await imageCache.image(id, sessionId && callId ? { sessionId, callId } : void 0);
        if (!image) {
          json(res, { error: "unknown image" }, 404);
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", image.contentType);
        res.setHeader("Content-Length", String(image.body.byteLength));
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("ETag", `"${image.etag}"`);
        res.end(image.body);
      } catch (error) {
        res.setHeader("Retry-After", "5");
        json(res, { error: error instanceof Error ? error.message : String(error) }, 503);
      }
    }
  }), "dsh-openui: cached image route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/openui/api/image-cache/status",
    async handler(_req, res) {
      json(res, await imageCache.status());
    }
  }), "dsh-openui: image cache status route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/openui/api/image-cache/clear",
    async handler(req, res) {
      if (req.method !== "POST") {
        json(res, { error: "POST required" }, 405);
        return;
      }
      await imageCache.clear();
      json(res, await imageCache.status());
    }
  }), "dsh-openui: image cache clear route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/openui/api/street-route",
    async handler(req, res) {
      const coords = new URL(req.url, "http://localhost").searchParams.get("coords");
      json(res, { points: await streetRoute(coords) });
    }
  }), "dsh-openui: street route");
}
function apply(ctx) {
  const imageCache = new ImageDiskCache(imageCacheRoot());
  void imageCache.init().catch((error) => ctx.logger.warn(`dsh-openui: image cache initialization failed: ${String(error)}`));
  registerRoutes(ctx, imageCache);
  ctx.effect(() => ctx.on("api-session/removed", (sessionId) => imageCache.releaseSession(sessionId)), "dsh-openui: release deleted session images");
  ctx.systemPrompt.section({
    name: "tool:render-openui",
    order: 6500,
    interpolate: false,
    text: ({ scope }) => ctx.tools.get("render_openui", scope) === void 0 ? "" : guidance
  });
  ctx.tools.register(defineTool({
    name: "render_openui",
    description: "Render the complete final answer as one interactive OpenUI Lang interface inline in the current DSH conversation, then end the turn. Use only when a visual or interactive answer is useful.",
    parameters: {
      program: {
        type: "string",
        required: true,
        description: "Complete OpenUI Lang program. The first line must define root."
      },
      title: {
        type: "string",
        description: "Short label shown above the interface."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          program: { type: "string", required: true },
          title: { type: "string" }
        }
      },
      render: (_args, value) => {
        const result = value;
        return [{ type: "text", text: `Rendered interactive interface${result.title ? `: ${result.title}` : ""}.` }];
      }
    },
    execute: async (args, exec) => {
      exec.concludeTurn();
      return args;
    }
  }));
}
export {
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
