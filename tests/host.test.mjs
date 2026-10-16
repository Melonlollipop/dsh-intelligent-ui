import assert from "node:assert/strict";
import test from "node:test";

import { apply } from "../lib/index.js";

test("render_openui concludes the turn after returning the interface", async () => {
  let tool;
  let section;
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
      register() {
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
      effect();
    },
  };

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
});
