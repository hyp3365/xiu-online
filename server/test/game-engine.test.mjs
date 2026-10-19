import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameEngine } from "../game-engine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const actions = JSON.parse(fs.readFileSync(path.join(HERE, "../action-whitelist.json"), "utf8"));

test("server runtime loads the existing game modules and whitelisted handlers", () => {
  const engine = new GameEngine();
  assert.equal(engine.G.modules.length, 23);
  assert.ok(engine.G.runTicks);
  assert.ok(actions.length > 80);
  for (const name of actions) {
    assert.equal(typeof engine.G[name], "function", `missing handler ${name}`);
    assert.notEqual(engine.G[name].constructor.name, "AsyncFunction", `async UI handler should not be whitelisted: ${name}`);
  }
  assert.ok(!actions.includes("gdCreate"));
});

test("button-driven study, purchase, garden, and out-of-body actions are authoritative", () => {
  const required = ["buyGongfa", "learnBlueprint", "learnCc", "learnForge", "learnGfBook", "learnGongfa", "learnJieGf", "learnMifa", "learnRecipe", "learnRingBp", "openField", "stopChuqiao"];
  for (const name of required) assert.ok(actions.includes(name), `missing server action ${name}`);

  const engine = new GameEngine();
  const start = 1_800_000_200_000;
  const state = engine.createState("灵田操作测试", start);
  state.stone = 1_000_000_000;
  const opened = engine.act(state, "openField", [], start + 1);
  assert.equal(opened.state.fields.length, 1);

  assert.throws(() => engine.act(opened.state, "clearField", [0, false], start + 2), /请先确认铲除灵田/);
  const cleared = engine.act(opened.state, "clearField", [0, true], start + 3);
  assert.equal(cleared.state.fields[0].g, -1);
});

test("ticks and player actions mutate only the server-owned state", () => {
  const engine = new GameEngine();
  const start = 1_800_000_000_000;
  const state = engine.createState("服务端测试", start);
  const settled = engine.advance(state, start + 20_000);
  assert.equal(settled.processedTicks, 2);
  assert.equal(settled.state.last, start + 20_000);
  assert.equal(settled.state.name, "服务端测试");

  const changed = engine.act(settled.state, "toggleAuto", [], start + 20_001);
  assert.equal(changed.state.auto, true);
  assert.equal(changed.state.last, start + 20_000);

  const settings = engine.act(changed.state, "cultSetSave", [undefined, "125", "450"], start + 20_002);
  assert.equal(settings.state.cultSet.low, 125);
  assert.equal(settings.state.cultSet.high, 450);
});

test("server module ticks complete due first-time gongfa learning", () => {
  const engine = new GameEngine();
  const start = 1_800_000_100_000;
  const state = engine.createState("功法结算测试", start);
  state.gfLearn = { id: "regression:test", k: "gf", ms: 5_000, end: start + 5_000 };

  const settled = engine.advance(state, start + 10_000);
  assert.equal(settled.state.gfLearn, null);
  assert.equal(settled.state.gongfa["regression:test"], 1);
  assert.ok(settled.logs.some(entry => entry.m.includes("习得功法")));
});
