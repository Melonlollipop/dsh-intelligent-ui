import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createParser } from "@openuidev/lang-core";

test("the generated spec exposes the full function and action surface", async () => {
  const spec = JSON.parse(await readFile(new URL("../generated/spec.json", import.meta.url), "utf8"));

  assert.equal(Object.keys(spec.functions ?? {}).length, 59);
  assert.deepEqual(Object.keys(spec.actions ?? {}), ["CopyToClipboard"]);
  for (const [name, definition] of Object.entries(spec.functions ?? {})) {
    assert.match(definition.description, /^[^\n]{8,240}$/, name);
  }
});

test("the generated library parses an interactive program", async () => {
  const spec = JSON.parse(await readFile(new URL("../generated/spec.json", import.meta.url), "utf8"));
  const parser = createParser(spec.schema, spec.root);
  const result = parser.parse(`root = Card([title, counter])
$count = 1
title = Title("DSH OpenUI", "lg")
counter = Row([IconButton("minus", @Set($count, $count - 1), "减少"), Text($count + "", "lg"), IconButton("plus", @Set($count, $count + 1), "增加")], 3)`);
  assert.deepEqual(result.meta.errors, []);
  assert.equal(result.root.type, "element");
});

test("the generated library parses an interactive routed map", async () => {
  const spec = JSON.parse(await readFile(new URL("../generated/spec.json", import.meta.url), "utf8"));
  const parser = createParser(spec.schema, spec.root);
  const result = parser.parse(`root = Col([Title("北京中轴线一日步行", "xl"), Map(markers, true)])
markers = [MapMarker("天安门", 39.9087, 116.3975, "中轴线", "🏛️"), MapMarker("景山公园", 39.9251, 116.3964, "中轴线", "🌳"), MapMarker("南锣鼓巷", 39.9371, 116.4034, "中轴线", "🥁")]`);
  assert.deepEqual(result.meta.errors, []);
  assert.equal(result.root.type, "element");
});
