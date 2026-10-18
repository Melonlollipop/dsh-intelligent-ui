import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/client/client.css", import.meta.url), "utf8");

test("OpenUI fills the DSH response column", () => {
  assert.match(css, /\.dsh-intelligent-ui-card\s*\{[\s\S]*?width:\s*100%;/);
  assert.match(css, /\.dsh-intelligent-ui-portal\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;/);
  assert.doesNotMatch(css, /width:\s*min\(100%,\s*880px\)/);
});

test("OpenUI descendants keep padding and borders inside their assigned width", () => {
  assert.match(css, /\.dsh-intelligent-ui-card \*,[\s\S]*?\.dsh-intelligent-ui-card \*::after\s*\{\s*box-sizing:\s*border-box;/);
});
