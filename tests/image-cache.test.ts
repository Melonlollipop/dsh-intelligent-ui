import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ImageDiskCache } from "../src/host/image-cache.ts";

const imageResponse = (body = "image") => new Response(Buffer.from(body), {
  status: 200,
  headers: { "content-type": "image/jpeg", "content-length": String(Buffer.byteLength(body)) },
});

const idFromUrl = (url: string) => url.split("/").at(-1)!;

test("retries transient downloads and restores images from disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-openui-cache-"));
  let requests = 0;
  const delays: number[] = [];
  const fetchMock: typeof fetch = async () => {
    requests += 1;
    return requests < 3 ? new Response("busy", { status: 503 }) : imageResponse("cached-image");
  };
  try {
    const cache = new ImageDiskCache(root, { fetch: fetchMock, sleep: async (delay) => { delays.push(delay); } });
    const [url] = await cache.rememberSearch("九溪十八涧", ["https://images.example/photo.jpg?utm_source=test"]);
    const id = idFromUrl(url);
    const first = await cache.image(id, { sessionId: "session-a", callId: "call-a" });

    assert.equal(first?.body.toString(), "cached-image");
    assert.equal(requests, 3);
    assert.deepEqual(delays, [750, 2_000]);
    assert.equal((await cache.status()).files, 1);

    const restored = new ImageDiskCache(root, { fetch: async () => { throw new Error("network should not be used"); } });
    assert.deepEqual(await restored.cachedSearch("九溪十八涧"), [url]);
    assert.equal((await restored.image(id, { sessionId: "session-a", callId: "call-a" }))?.body.toString(), "cached-image");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deletes an image only after its last session reference is removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-openui-cache-"));
  let requests = 0;
  try {
    const cache = new ImageDiskCache(root, { fetch: async () => { requests += 1; return imageResponse(); } });
    const id = idFromUrl(await cache.registerSource("https://images.example/shared.jpg"));

    await cache.image(id, { sessionId: "session-a", callId: "call-a" });
    await cache.image(id, { sessionId: "session-b", callId: "call-b" });
    assert.equal(requests, 1);
    assert.equal((await cache.status()).sessions, 2);

    await cache.releaseSession("session-a");
    assert.equal((await cache.status()).files, 1);
    await cache.releaseSession("session-b");
    assert.equal((await cache.status()).files, 0);
    assert.equal((await cache.status()).sessions, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repairs invalid legacy owner identifiers and never retains them again", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-openui-cache-"));
  try {
    const cache = new ImageDiskCache(root, { fetch: async () => imageResponse() });
    const id = idFromUrl(await cache.registerSource("https://images.example/legacy.jpg"));
    await cache.image(id, { sessionId: "undefined", callId: "call-a" });
    assert.equal((await cache.status()).sessions, 0);

    const indexPath = join(root, "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    index.sessions.undefined = { "call-a": [id] };
    await writeFile(indexPath, `${JSON.stringify(index)}\n`, "utf8");

    const restored = new ImageDiskCache(root, { fetch: async () => { throw new Error("network should not be used"); } });
    assert.equal((await restored.status()).sessions, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evicts old files over the size limit and repairs orphan files at startup", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsh-openui-cache-"));
  let requests = 0;
  try {
    await mkdir(join(root, "images"), { recursive: true });
    await writeFile(join(root, "images", "orphan.tmp"), "orphan", "utf8");

    const cache = new ImageDiskCache(root, {
      maxBytes: 6,
      targetBytes: 4,
      fetch: async (url) => { requests += 1; return imageResponse(String(url).includes("one") ? "1111" : "2222"); },
    });
    await cache.init();
    const [one, two] = await Promise.all([
      cache.registerSource("https://images.example/one.jpg"),
      cache.registerSource("https://images.example/two.jpg"),
    ]);
    await cache.image(idFromUrl(one), { sessionId: "session-a", callId: "call-a" });
    await cache.image(idFromUrl(two), { sessionId: "session-b", callId: "call-b" });

    const status = await cache.status();
    assert.equal(status.files, 1);
    assert.equal(status.bytes, 4);
    assert.equal(requests, 2);
    await assert.rejects(readFile(join(root, "images", "orphan.tmp")));

    await cache.clear();
    assert.deepEqual(await cache.status(), { files: 0, bytes: 0, images: 0, searches: 0, sessions: 0, root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
