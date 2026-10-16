import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createParser } from "@openuidev/lang-core";

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
