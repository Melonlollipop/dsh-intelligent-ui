import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { webUrl } from "../src/openui/components/style.ts";
import {
  loadRendererState,
  rendererErrorMessages,
  rendererStateKey,
  saveRendererState,
} from "../src/client/renderer-support.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
}

test("persists renderer state per tool call", () => {
  const storage = memoryStorage();
  const state = { $selected: "故宫", planner: { pace: { value: "relaxed", componentType: "Select" } } };

  saveRendererState(storage, "call-1", state);

  assert.deepEqual(loadRendererState(storage, "call-1"), state);
  assert.equal(loadRendererState(storage, "call-2"), undefined);
  assert.match(rendererStateKey("call-1"), /call-1$/);
});

test("ignores invalid persisted renderer state", () => {
  const storage = memoryStorage();
  storage.setItem(rendererStateKey("bad-json"), "{");
  storage.setItem(rendererStateKey("array"), "[]");

  assert.equal(loadRendererState(storage, "bad-json"), undefined);
  assert.equal(loadRendererState(storage, "array"), undefined);
});

test("formats actionable renderer errors and omits warnings", () => {
  const messages = rendererErrorMessages([
    { source: "parser", code: "unknown-component", message: "Unknown component Foo", statementId: "panel", hint: "Use Card" },
    { source: "parser", code: "no-root", message: "Using the last statement", severity: "warning" },
  ]);

  assert.deepEqual(messages, ["[panel] Unknown component Foo Use Card"]);
});

test("allows only absolute HTTP(S) links", () => {
  assert.equal(webUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(webUrl("http://example.com"), "http://example.com");
  assert.equal(webUrl("javascript:alert(1)"), null);
  assert.equal(webUrl("/relative"), null);
});

test("the DSH renderer wires persistence and upstream action handling", async () => {
  const source = await readFile(new URL("../src/client/index.tsx", import.meta.url), "utf8");

  assert.match(source, /initialState=\{initialState\}/);
  assert.match(source, /onStateUpdate=\{persistState\}/);
  assert.match(source, /onError=\{setRendererErrors\}/);
  assert.match(source, /runLibraryAction\(event\)/);
  assert.match(source, /webUrl\(event\.params\.url\)/);
});
