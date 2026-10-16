import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "dsh-openui";
export const inject = ["tools", "systemPrompt", "webServer", "clientModules"];

type HttpRequest = { url?: string };
type HttpResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
};

type Context = {
  tools: {
    register(tool: unknown): () => void;
    get(name: string, scope: unknown): unknown;
  };
  systemPrompt: {
    section(section: { name: string; order: number; interpolate?: boolean; text: string | ((context: { scope: unknown }) => string) }): () => void;
  };
  webServer: {
    register(route: { kind: "exact"; path: string; handler(req: HttpRequest, res: HttpResponse): Promise<void> }): () => void;
  };
  clientModules: {
    graph(): { entries: { id: string; rev: string }[] };
    clientPath(id: string): string | undefined;
  };
  effect(effect: () => () => void, label?: string): void;
};

type WikiSummary = { thumbnail?: { source?: string }; coordinates?: { lat?: number; lon?: number } };
type WikiMedia = { items?: { type?: string; srcset?: { src: string }[] }[] };
type WikiInfo = { lat?: number; lng?: number; photos: string[] };
type Page = { index?: number; title?: string; thumbnail?: { source?: string }; imageinfo?: { thumburl?: string; url?: string; mime?: string }[] };
type RenderArgs = { program: string; title?: string };

const wikiCache = new Map<string, WikiInfo>();
const imageCache = new Map<string, string[]>();
const headers = { "User-Agent": "dsh-openui/0.1" };
const skipImage = /\.svg|icon|logo|map|flag|seal|coat_of_arms|signature|diagram/i;

const promptPath = join(dirname(fileURLToPath(import.meta.url)), "..", "generated", "system-prompt.txt");
const generatedPrompt = readFileSync(promptPath, "utf8").replace(
  /^You are an AI assistant that responds using openui-lang, a declarative UI language\. Your ENTIRE response must be valid openui-lang code — no markdown, no explanations, just openui-lang\.$/m,
  "The render_openui program must be valid openui-lang code: no markdown or explanations inside the program string.",
);

const guidance = `Use render_openui when an interactive or visual answer materially improves the result: comparisons, plans, calculators, charts, checklists, step-by-step guides, diagrams, small games, forms, or exploratory interfaces. For ordinary prose, code, terminal work, and short factual answers, respond normally without this tool.

When you use render_openui, it is the complete final answer and ends the current turn. Call it once. Put every user-facing part of the answer in the program argument and a short visible label in title. Do not write prose before or after the tool call. Do not add audit notes, verification notes, caveats, source summaries, or implementation commentary unless the user explicitly asks for them; when requested, place them inside the interface.

${generatedPrompt}`;

function json(res: HttpResponse, value: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.end(JSON.stringify(value));
}

async function get(url: string) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (response.status === 404) return {};
  if (!response.ok) throw new Error(`Wikipedia ${response.status}`);
  return response.json();
}

async function wiki(title: string): Promise<WikiInfo> {
  const cached = wikiCache.get(title);
  if (cached) return cached;
  const slug = encodeURIComponent(title.replace(/ /g, "_"));
  const [summary, media] = await Promise.all([
    get(`https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`),
    get(`https://en.wikipedia.org/api/rest_v1/page/media-list/${slug}`),
  ]) as [WikiSummary, WikiMedia];
  const photos: string[] = [];
  const key = (url: string) => decodeURIComponent(url.split("?")[0]!.split("/").at(-1)!).replace(/^\d+px-/, "");
  if (summary.thumbnail?.source) photos.push(summary.thumbnail.source);
  for (const item of media.items ?? []) {
    if (item.type !== "image" || !item.srcset?.length) continue;
    const source = item.srcset[0]!.src;
    if (skipImage.test(source)) continue;
    const url = source.startsWith("//") ? `https:${source}` : source;
    if (!photos.some((photo) => key(photo) === key(url))) photos.push(url);
    if (photos.length === 3) break;
  }
  const info = { lat: summary.coordinates?.lat, lng: summary.coordinates?.lon, photos };
  wikiCache.set(title, info);
  return info;
}

async function query(host: string, params: Record<string, string>): Promise<Page[]> {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params })}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${host} ${response.status}`);
  const data = await response.json() as { error?: unknown; query?: { pages?: Page[] } };
  if (data.error) throw new Error(`${host} error`);
  return (data.query?.pages ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 3);

async function searchImages(search: string): Promise<string[]> {
  const cached = imageCache.get(search);
  if (cached) return cached;
  const images: string[] = [];
  const add = (url: string | undefined) => {
    if (url?.startsWith("https://") && !skipImage.test(url) && !images.includes(url)) images.push(url);
  };
  const wanted = new Set(words(search));
  const articles = await query("en.wikipedia.org", {
    generator: "search",
    gsrsearch: search,
    gsrlimit: "6",
    prop: "pageimages",
    piprop: "thumbnail",
    pithumbsize: "960",
  });
  articles.filter((page) => words(page.title ?? "").some((word) => wanted.has(word))).forEach((page) => add(page.thumbnail?.source));
  const terms = search.split(/\s+/);
  for (const candidate of new Set([terms.join(" "), terms.slice(0, 3).join(" "), terms.slice(0, 2).join(" ")])) {
    if (images.length >= 3) break;
    const files = await query("commons.wikimedia.org", {
      generator: "search",
      gsrsearch: `${candidate} filetype:bitmap`,
      gsrnamespace: "6",
      gsrlimit: "6",
      prop: "imageinfo",
      iiprop: "url|mime",
      iiurlwidth: "960",
    });
    files.forEach((page) => {
      const info = page.imageinfo?.[0];
      if (info?.mime?.startsWith("image/")) add(info.thumburl ?? info.url);
    });
  }
  const result = images.slice(0, 4);
  imageCache.set(search, result);
  return result;
}

function registerRoutes(ctx: Context) {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/openui/status",
    async handler(_req, res) {
      const entry = ctx.clientModules.graph().entries.find((item) => item.id === "dsh-openui")!;
      json(res, {
        plugin: name,
        clientModule: entry,
        clientPath: ctx.clientModules.clientPath("dsh-openui"),
      });
    },
  }), "dsh-openui: status route");

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/openui/api/wiki",
    async handler(req, res) {
      const title = new URL(req.url!, "http://localhost").searchParams.get("title")!.trim();
      json(res, await wiki(title));
    },
  }), "dsh-openui: wiki image route");

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/openui/api/image-search",
    async handler(req, res) {
      const search = new URL(req.url!, "http://localhost").searchParams.get("q")!.replace(/\s+/g, " ").trim();
      json(res, { images: await searchImages(search) });
    },
  }), "dsh-openui: image search route");
}

export function apply(ctx: Context) {
  registerRoutes(ctx);
  ctx.systemPrompt.section({
    name: "tool:render-openui",
    order: 6500,
    interpolate: false,
    text: ({ scope }) => ctx.tools.get("render_openui", scope) === undefined ? "" : guidance,
  });
  ctx.tools.register(defineTool({
    name: "render_openui",
    description: "Render the complete final answer as one interactive OpenUI Lang interface inline in the current DSH conversation, then end the turn. Use only when a visual or interactive answer is useful.",
    parameters: {
      program: {
        type: "string",
        required: true,
        description: "Complete OpenUI Lang program. The first line must define root.",
      },
      title: {
        type: "string",
        description: "Short label shown above the interface.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          program: { type: "string", required: true },
          title: { type: "string" },
        },
      },
      render: (_args: unknown, value: unknown) => {
        const result = value as { title?: string };
        return [{ type: "text", text: `Rendered interactive interface${result.title ? `: ${result.title}` : ""}.` }];
      },
    },
    execute: async (args: RenderArgs, exec: { concludeTurn(): void }) => {
      exec.concludeTurn();
      return args;
    },
  }));
}
