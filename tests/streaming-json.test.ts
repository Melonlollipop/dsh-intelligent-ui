import assert from "node:assert/strict";
import test from "node:test";
import { readStreamingString } from "../src/client/streaming-json.ts";

test("reads an incomplete streamed program string", () => {
  const raw = '{"program":"root = Col([title])\\ntitle = Title(\\"你好';
  assert.equal(readStreamingString(raw, "program"), 'root = Col([title])\ntitle = Title("你好');
});

test("reads title and complete escaped content", () => {
  const raw = '{"program":"root = Col([Text(\\"A\\tB\\")])","title":"演示"}';
  assert.equal(readStreamingString(raw, "program"), 'root = Col([Text("A\tB")])');
  assert.equal(readStreamingString(raw, "title"), "演示");
});
