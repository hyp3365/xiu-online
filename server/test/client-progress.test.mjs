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

test("progress wraps on the authoritative tick boundary and remains continuous after a late snapshot", () => {
  G._lastTick = 1_000;

  clock.now = 10_999;
  assert.ok(Math.abs(G.tickPct() - 99.99) < 0.001);

  // At exactly one 10-second cycle the display starts at zero, rather than
  // remaining pinned at 100% until the next server snapshot.
  clock.now = 11_000;
  assert.equal(G.tickPct(), 0);

  // If a snapshot arrives 1 second after the boundary, the old and new
  // authoritative anchors render the same 10% phase, so the bar does not jump.
  clock.now = 12_000;
  const beforeSnapshot = G.tickPct();
  G._lastTick = 11_000;
  const afterSnapshot = G.tickPct();
  assert.equal(beforeSnapshot, 10);
  assert.equal(afterSnapshot, beforeSnapshot);

  // Several elapsed cycles still display only the current visual phase.
  G._lastTick = 1_000;
  clock.now = 23_000;
  assert.equal(G.tickPct(), 20);
});
