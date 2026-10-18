import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function messageQueue(socket) {
  const messages = [];
  const waiters = [];
  socket.on("message", raw => {
    const message = JSON.parse(raw.toString("utf8"));
    const i = waiters.findIndex(w => w.predicate(message));
    if (i >= 0) { const [waiter] = waiters.splice(i, 1); clearTimeout(waiter.timer); waiter.resolve(message); }
    else messages.push(message);
  });
  return (predicate, timeout = 8000) => {
    const i = messages.findIndex(predicate);
    if (i >= 0) return Promise.resolve(messages.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: setTimeout(() => {
        const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index, 1);
        reject(new Error("timed out waiting for WebSocket message"));
      }, timeout) };
      waiters.push(waiter);
    });
  };
}

async function waitHealth(base, child) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})`);
    try { const r = await fetch(`${base}/health`); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy");
}

async function post(base, route, token, payload = {}) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Token": token } : {}) },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${route}: ${data.error || response.status}`);
  return data;
}

test("HTTP auth and WebSocket actions use authoritative server state", { timeout: 30_000 }, async t => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xiu-online-test-"));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(HERE, "../server.mjs")], {
    cwd: path.join(HERE, ".."),
    env: { ...process.env, XIU_HOST: "127.0.0.1", XIU_PORT: String(port), XIU_DATA_DIR: dataDir },
    stdio: "ignore",
  });
  let socket, socket2;
  t.after(async () => {
    socket?.close();
    socket2?.close();
    if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await waitHealth(base, child);
  const registered = await post(base, "/api/register", null, { username: `test_${Date.now()}`, password: "test-password-123" });
  const token = registered.token;
  assert.ok(token);
  const initial = await fetch(`${base}/api/session`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.equal(initial.data, null);
  assert.ok(initial.actions.includes("toggleAuto"));

  const character = await post(base, "/api/character", token, { name: "服务器新档" });
  assert.equal(character.data.name, "服务器新档");
  assert.equal(character.data.auto, false);

  const { ticket } = await post(base, "/api/ws-ticket", token);
  socket = new WebSocket(`${base.replace("http:", "ws:")}/api/ws?ticket=${encodeURIComponent(ticket)}`);
  const waitFor = messageQueue(socket);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const first = await waitFor(m => m.type === "snapshot");
  assert.equal(first.state.name, "服务器新档");

  const id = "test-action-0001";
  socket.send(JSON.stringify({ type: "action", id, action: "toggleAuto", args: [] }));
  const success = await waitFor(m => m.type === "result" && m.id === id);
  assert.equal(success.ok, true);
  assert.equal(success.state.auto, true);

  // A duplicate operation id returns its original receipt and cannot toggle twice.
  socket.send(JSON.stringify({ type: "action", id, action: "toggleAuto", args: [] }));
  const duplicate = await waitFor(m => m.type === "result" && m.id === id);
  assert.equal(duplicate.state.auto, true);

  socket.send(JSON.stringify({ type: "action", id: "test-action-0002", action: "openField", args: [] }));
  const rejected = await waitFor(m => m.type === "result" && m.id === "test-action-0002");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.state.auto, true);

  const persisted = await fetch(`${base}/api/session`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.equal(persisted.data.auto, true);

  const users = await fetch(`${base}/api/admin/users`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.equal(users.list[0].admin, true);
  assert.equal(typeof users.reg_open, "boolean");
  await post(base, "/api/admin/gift", token, { code: "SERVERTESTGIFT", items: [{ c: "stone", n: 25 }], uses: 1 });
  const gifts = await fetch(`${base}/api/admin/gifts`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.equal(gifts.list[0].code, "SERVERTESTGIFT");
  const gift = await post(base, "/api/gift", token, { code: "SERVERTESTGIFT" });
  assert.equal(gift.state.stone, persisted.data.stone + 25);
  assert.equal(gift.got.length, 1);

  // A second user has a separate VM and state even while the first socket is live.
  const secondToken = (await post(base, "/api/register", null, { username: `test2_${Date.now()}`, password: "test-password-456" })).token;
  const secondChar = await post(base, "/api/character", secondToken, { name: "隔离账号" });
  assert.equal(secondChar.data.auto, false);
  const ticket2 = (await post(base, "/api/ws-ticket", secondToken)).ticket;
  socket2 = new WebSocket(`${base.replace("http:", "ws:")}/api/ws?ticket=${encodeURIComponent(ticket2)}`);
  const waitFor2 = messageQueue(socket2);
  await new Promise((resolve, reject) => { socket2.once("open", resolve); socket2.once("error", reject); });
  assert.equal((await waitFor2(m => m.type === "snapshot")).state.name, "隔离账号");
  socket2.send(JSON.stringify({ type: "action", id: "second-player-01", action: "toggleAuto", args: [] }));
  assert.equal((await waitFor2(m => m.type === "result" && m.id === "second-player-01")).state.auto, true);
  const firstAgain = await fetch(`${base}/api/session`, { headers: { "X-Token": token } }).then(r => r.json());
  assert.equal(firstAgain.data.auto, true);
  assert.equal(firstAgain.data.stone, persisted.data.stone + 25);
});
