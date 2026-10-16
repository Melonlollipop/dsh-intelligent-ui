import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("render_openui concludes the turn after returning the interface", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "dsh-openui-host-test-"));
  const previousCacheRoot = process.env.DSH_OPENUI_CACHE_DIR;
  process.env.DSH_OPENUI_CACHE_DIR = cacheRoot;
  const { apply } = await import(`../lib/index.js?test=${Date.now()}`);
  let tool;
  let section;
  const routes = [];
  const events = new Map();
  const disposers = [];
  const ctx = {
    tools: {
      register(value) {
        tool = value;
        return () => {};
      },
      get() {
        return tool;
      },
    },
    systemPrompt: {
      section(value) {
        section = value;
        return () => {};
      },
    },
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
    clientModules: {
      graph() {
        return { entries: [{ id: "dsh-openui", rev: "test" }] };
      },
      clientPath() {
        return "client.js";
      },
    },
    effect(effect) {
      const dispose = effect();
      if (typeof dispose === "function") disposers.push(dispose);
    },
    on(event, listener) {
      events.set(event, listener);
      return () => events.delete(event);
    },
    logger: {
      warn() {},
    },
  };

  try {
    apply(ctx);
    let concluded = false;
    const args = { program: 'root = Title("完成")', title: "测试" };
    const result = await tool.execute(args, {
      concludeTurn() {
        concluded = true;
      },
    });

    assert.equal(concluded, true);
    assert.deepEqual(result, args);
    assert.match(tool.description, /end the turn/);
    assert.match(section.text({ scope: {} }), /ends the current turn/);
    assert.ok(routes.some((route) => route.path === "/openui/maplibre-gl-worker.mjs"));
    assert.ok(routes.some((route) => route.path === "/openui/api/street-route"));
    assert.ok(routes.some((route) => route.path === "/openui/api/image" && route.kind === "prefix"));
    assert.ok(routes.some((route) => route.path === "/openui/api/image-cache/clear"));
    assert.equal(typeof events.get("api-session/removed"), "function");

    const statusRoute = routes.find((route) => route.path === "/openui/api/image-cache/status");
    let statusBody = "";
    await statusRoute.handler({ method: "GET", url: statusRoute.path }, {
      statusCode: 0,
      setHeader() {},
      end(value) { statusBody = String(value ?? ""); },
    });
    assert.equal(JSON.parse(statusBody).files, 0);
  } finally {
    disposers.reverse().forEach((dispose) => dispose());
    if (previousCacheRoot === undefined) delete process.env.DSH_OPENUI_CACHE_DIR;
    else process.env.DSH_OPENUI_CACHE_DIR = previousCacheRoot;
    await rm(cacheRoot, { recursive: true, force: true });
  }
});
