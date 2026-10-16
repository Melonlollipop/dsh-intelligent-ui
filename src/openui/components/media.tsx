"use client";

import { defineComponent } from "@openuidev/react-lang";
import { ImageIcon } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod/v4";
import { withBase } from "../base-path";
import { Glyph } from "./glyph";
import { color, cx, fg, radius, radiusSchema, webUrl } from "./style";

const ICON_SIZE = { sm: 14, md: 18, lg: 24, xl: 32 } as const;
const IMAGE_RETRY_DELAYS = [750, 2_000, 5_000] as const;

type ImageOwner = { sessionId: string; callId: string };
const ImageOwnerContext = createContext<ImageOwner | null>(null);

export function ImageOwnerProvider({ sessionId, callId, children }: ImageOwner & { children: ReactNode }) {
  return <ImageOwnerContext.Provider value={{ sessionId, callId }}>{children}</ImageOwnerContext.Provider>;
}

export const Icon = defineComponent({
  name: "Icon",
  props: z.object({
    name: z.string(),
    size: z.enum(["sm", "md", "lg", "xl"]).optional(),
    color: color.optional(),
  }),
  description: 'Lucide icon by name, e.g. "map-pin".',
  component: ({ props }) => (
    <span className="iui-icon" style={{ color: fg(props.color) }}>
      <Glyph name={props.name} size={ICON_SIZE[props.size ?? "md"] ?? 18} />
    </span>
  ),
});

// Image search and local proxy registration
const searches = new Map<string, Promise<string[]>>();
const sources = new Map<string, Promise<string | null>>();

async function getJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  return response.ok ? ((await response.json()) as Record<string, unknown>) : {};
}

const internalImageUrl = (value: unknown): value is string => typeof value === "string" && /^\/openui\/api\/image\/[a-f0-9]{64}$/.test(value);
const urls = (value: unknown) => (Array.isArray(value) ? value.filter(internalImageUrl) : []);

function searchImages(query: string, refresh: number): Promise<string[]> {
  const key = `${query}\u0000${refresh}`;
  let request = searches.get(key);
  if (!request) {
    request = getJson(withBase(`/api/image-search?q=${encodeURIComponent(query)}&refresh=${refresh}`)).then((found) => {
      const all = urls(found.images);
      if (!all.length) searches.delete(key);
      return all;
    }).catch(() => {
      searches.delete(key);
      return [];
    });
    if (searches.size > 200) searches.delete(searches.keys().next().value!);
    searches.set(key, request);
  }
  return request;
}

function sourceImage(source: string, refresh: number): Promise<string | null> {
  const key = `${source}\u0000${refresh}`;
  let request = sources.get(key);
  if (!request) {
    request = getJson(withBase(`/api/image-source?url=${encodeURIComponent(source)}`)).then((result) => (
      internalImageUrl(result.image) ? result.image : null
    )).catch(() => null);
    if (sources.size > 200) sources.delete(sources.keys().next().value!);
    sources.set(key, request);
  }
  return request;
}

/** Search results for `query`, or undefined while waiting. The query settles first: it may still be streaming. */
function useImageSearch(query: string | null, refresh: number): string[] | undefined {
  const [result, setResult] = useState<{ key: string; images: string[] } | null>(null);
  const key = query ? `${query}\u0000${refresh}` : "";
  useEffect(() => {
    if (!query) return;
    let active = true;
    const timer = setTimeout(() => {
      searchImages(query, refresh).then((images) => {
        if (active) setResult({ key, images });
      });
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, query, refresh]);
  return query && result?.key === key ? result.images : undefined;
}

function useImageSource(source: string | null, refresh: number): string | null | undefined {
  const [result, setResult] = useState<{ key: string; image: string | null } | null>(null);
  const key = source ? `${source}\u0000${refresh}` : "";
  useEffect(() => {
    if (!source) return;
    let active = true;
    sourceImage(source, refresh).then((image) => {
      if (active) setResult({ key, image });
    });
    return () => { active = false; };
  }, [key, refresh, source]);
  if (!source) return null;
  return result?.key === key ? result.image : undefined;
}

function ownedImageUrl(url: string, owner: ImageOwner | null, attempt: number, refresh: number): string {
  const params = new URLSearchParams();
  if (owner) {
    params.set("sessionId", owner.sessionId);
    params.set("callId", owner.callId);
  }
  params.set("attempt", String(attempt));
  params.set("refresh", String(refresh));
  return `${url}?${params}`;
}

type PhotoProps = { query: string; src?: string | null; aspectRatio?: number | null; radius?: unknown; fit?: string | null };

/** A photo from src, or, without one or when it fails, the best search result for query. */
function Photo(props: PhotoProps) {
  const owner = useContext(ImageOwnerContext);
  const alt = typeof props.query === "string" ? props.query.trim() : "";
  const src = webUrl(props.src);
  const [failed, setFailed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const localSource = useImageSource(src, refresh);
  const sourceSettled = !src || localSource !== undefined;
  const needSearch = sourceSettled && (!localSource || failed.includes(localSource)) && alt.length > 2;
  const found = useImageSearch(needSearch ? alt : null, refresh);
  const current = [localSource, ...(found ?? [])].find((url): url is string => !!url && !failed.includes(url));
  const settled = sourceSettled && !current && (!needSearch || found !== undefined);
  const requestUrl = current ? ownedImageUrl(current, owner, attempt, refresh) : null;
  const ratio = typeof props.aspectRatio === "number" && props.aspectRatio > 0.2 && props.aspectRatio < 5 ? props.aspectRatio : 1.5;

  useEffect(() => {
    setAttempt(0);
    setLoaded(null);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = undefined;
  }, [current]);

  useEffect(() => {
    if (!settled) return;
    const timer = setTimeout(() => {
      setFailed([]);
      setRefresh((value) => value + 1);
    }, 30_000);
    return () => clearTimeout(timer);
  }, [settled]);

  useEffect(() => {
    const retry = () => {
      setFailed([]);
      setRefresh((value) => value + 1);
    };
    window.addEventListener("online", retry);
    return () => {
      window.removeEventListener("online", retry);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  const failCurrent = () => {
    if (!current || retryTimer.current) return;
    if (attempt < IMAGE_RETRY_DELAYS.length) {
      retryTimer.current = setTimeout(() => {
        retryTimer.current = undefined;
        setAttempt((value) => value + 1);
      }, IMAGE_RETRY_DELAYS[attempt]);
      return;
    }
    setFailed((list) => list.includes(current) ? list : [...list, current]);
  };

  const loadCurrent = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = undefined;
    if (requestUrl) setLoaded(requestUrl);
  };

  return (
    <div
      className={cx("iui-image", props.fit === "contain" && "is-contain", loaded === requestUrl && "is-loaded")}
      style={{ aspectRatio: ratio, borderRadius: radius(props.radius ?? "lg") }}
      role={current ? undefined : "img"}
      aria-label={current ? undefined : alt}
    >
      {current && requestUrl ? (
        <img
          key={requestUrl}
          src={requestUrl}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={loadCurrent}
          onError={failCurrent}
        />
      ) : settled ? (
        <ImageIcon aria-hidden className="iui-image-empty" strokeWidth={1.5} />
      ) : null}
    </div>
  );
}

const fit = z.enum(["cover", "contain"]).optional();

export const SearchImage = defineComponent({
  name: "SearchImage",
  props: z.object({ query: z.string(), aspectRatio: z.number().optional(), radius: radiusSchema.optional(), fit }),
  description:
    'A real photo the app finds for query; it needs no URL and no tool. Name the exact thing in 2 to 4 words: "Belém Tower Lisbon", "iPhone 17", "pastel de nata". Use one for every place, dish, product or thing with a look.',
  component: ({ props }) => <Photo {...props} />,
});

export const Image = defineComponent({
  name: "Image",
  props: z.object({ src: z.string(), alt: z.string(), aspectRatio: z.number().optional(), radius: radiusSchema.optional(), fit }),
  description: "Photo from a URL the user or a tool gave; if it fails, a photo is found for alt.",
  component: ({ props }) => <Photo query={props.alt} src={props.src} aspectRatio={props.aspectRatio} radius={props.radius} fit={props.fit} />,
});
