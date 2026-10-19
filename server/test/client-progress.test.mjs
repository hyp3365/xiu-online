import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const gamePath = path.resolve(HERE, "../../web/js/core/game.js");
const gameSource = fs.readFileSync(gamePath, "utf8");
const clock = { now: 0 };
class TestDate extends Date { static now() { return clock.now; } }
const context = vm.createContext({ Date: TestDate, DATA: { TICK: 10 } });
vm.runInContext(`${gameSource}\nglobalThis.__testGame = G;`, context, { filename: gamePath });
const G = context.__testGame;

test("progress holds at 100% until the server settles the tick, then restarts from the new anchor", () => {
  G._lastTick = 1_000;

  clock.now = 10_999;
  assert.ok(Math.abs(G.tickPct() - 99.99) < 0.001);

  // The bar does not wrap before the server's settlement arrives.
  clock.now = 11_000;
  assert.equal(G.tickPct(), 100);
  clock.now = 11_400;
  assert.equal(G.tickPct(), 100);

  // The settlement snapshot moves the anchor; the bar restarts in step with it.
  G._lastTick = 11_000;
  assert.equal(G.tickPct(), 4);

  // If no settlement arrives for a long time (disconnected), the display keeps cycling.
  G._lastTick = 1_000;
  clock.now = 23_000;
  assert.equal(G.tickPct(), 20);
});
