import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import Database from "better-sqlite3";
import { WebSocketServer, WebSocket } from "ws";
import { GameEngine } from "./game-engine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.XIU_HOST || "127.0.0.1";
const PORT = Number(process.env.XIU_PORT || 18301);
const DATA_DIR = path.resolve(process.env.XIU_DATA_DIR || path.join(HERE, "data"));
const DB_FILE = path.resolve(process.env.XIU_DB_PATH || path.join(DATA_DIR, "xiu-online.sqlite3"));
const WS_PATH = "/api/ws";
const MAX_HTTP_BODY = 64 * 1024;
const MAX_WS_PAYLOAD = 16 * 1024;
const ACTIONS = new Set(JSON.parse(fs.readFileSync(path.join(HERE, "action-whitelist.json"), "utf8")));
const PBKDF2_ROUNDS = 240_000;
const validationEngine = new GameEngine();
for (const name of ACTIONS) if (typeof validationEngine.G[name] !== "function") throw new Error(`Missing whitelisted action: ${name}`);

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o750 });
const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS tokens(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS saves(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS gifts(code TEXT PRIMARY KEY, payload TEXT NOT NULL, max_uses INTEGER NOT NULL DEFAULT 1, used_count INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS gift_uses(code TEXT NOT NULL REFERENCES gifts(code) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, used_at INTEGER NOT NULL, PRIMARY KEY(code,user_id));
`);
const q = {
  byName: db.prepare("SELECT * FROM users WHERE username=?"),
  byId: db.prepare("SELECT * FROM users WHERE id=?"),
  token: db.prepare("SELECT user_id,expires_at FROM tokens WHERE token_hash=?"),
  save: db.prepare("SELECT data,revision,updated_at FROM saves WHERE user_id=?"),
  revision: db.prepare("SELECT revision FROM saves WHERE user_id=?"),
  saveUpsert: db.prepare(`INSERT INTO saves(user_id,data,revision,updated_at) VALUES(?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,revision=saves.revision+1,updated_at=excluded.updated_at`),
};
const clients = new Map();
const tickets = new Map();
const receipts = new WeakMap();
const engines = new Map();
const startedAt = Date.now();
const REPO_DIR = path.resolve(HERE, "..");
const UPDATE_LOG = path.join(DATA_DIR, "update.log");
const UPDATE_TRIGGER = path.join(DATA_DIR, "update.request");

function repoVersion() {
  return new Promise(resolve => execFile("git", ["-c", "safe.directory=*", "-C", REPO_DIR, "log", "-1", "--format=%h  %s  (%cd)", "--date=format:%Y-%m-%d %H:%M"], { timeout: 5000 },
    (err, stdout, stderr) => resolve(String(stdout || "").trim() || String(stderr || "").trim() || (err ? err.message : "未知"))));
}
function readUpdateLog() {
  try { return fs.readFileSync(UPDATE_LOG, "utf8").slice(-4000); } catch { return ""; }
}

function getEngine(userId) {
  let entry = engines.get(userId);
  if (!entry) { entry = { engine: new GameEngine(), lastUsed: Date.now() }; engines.set(userId, entry); }
  entry.lastUsed = Date.now();
  return entry.engine;
}

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
  res.end(data);
}
function error(res, status, message) { return sendJson(res, status, { error: message }); }
function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
function passwordHash(password, salt) { return crypto.pbkdf2Sync(password, salt, PBKDF2_ROUNDS, 32, "sha256").toString("hex"); }
function equalHex(a, b) {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b) || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
function issueToken(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO tokens(token_hash,user_id,expires_at) VALUES(?,?,?)").run(hashToken(token), userId, Date.now() + 90 * 86400_000);
  return token;
}
function userFor(req) {
  const token = String(req.headers["x-token"] || "");
  if (!token || token.length > 256) return null;
  const record = q.token.get(hashToken(token));
  if (!record || record.expires_at < Date.now()) return null;
  return q.byId.get(record.user_id) || null;
}
function getState(userId) {
  const row = q.save.get(userId);
  if (!row) return null;
  try { return JSON.parse(row.data); } catch { throw new Error("服务器存档损坏，请联系管理员"); }
}
function persist(userId, state) {
  const data = JSON.stringify(state);
  if (Buffer.byteLength(data) > 4 * 1024 * 1024) throw new Error("角色数据超出安全大小限制");
  q.saveUpsert.run(userId, data, Date.now());
}
function registrationOpen() {
  const value = db.prepare("SELECT value FROM settings WHERE key='registration_open'").get()?.value;
  return value === undefined || value === "true";
}
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_HTTP_BODY) throw Object.assign(new Error("请求过大"), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("请求 JSON 格式错误"), { status: 400 }); }
}
function validUsername(raw) {
  const username = String(raw || "").trim();
  if (username.length < 2 || username.length > 20 || !/^[\p{L}\p{N}_-]+$/u.test(username)) throw new Error("账号需为 2–20 个字母、数字、中文、下划线或连字符");
  return username;
}
function validateValue(value, depth = 0) {
  if (depth > 5) throw new Error("操作参数层级过深");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") { if (value.length > 2048) throw new Error("操作参数过长"); return; }
  if (typeof value === "number") { if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw new Error("操作参数无效"); return; }
  if (Array.isArray(value)) { if (value.length > 100) throw new Error("操作参数数组过长"); return value.forEach(x => validateValue(x, depth + 1)); }
  if (typeof value === "object") {
    const pairs = Object.entries(value); if (pairs.length > 50) throw new Error("操作参数对象过大");
    for (const [key, child] of pairs) { if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("操作参数字段无效"); validateValue(child, depth + 1); }
    return;
  }
  throw new Error("操作参数类型无效");
}
function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const explicit = (process.env.XIU_ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    if (explicit.length) return explicit.includes(parsed.origin);
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    return parsed.host === host;
  } catch { return false; }
}
function createWsTicket(userId) {
  const ticket = crypto.randomBytes(24).toString("base64url");
  tickets.set(ticket, { userId, expiresAt: Date.now() + 30_000 });
  return ticket;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const route = url.pathname;
  try {
    if (req.method === "GET" && route === "/health") return sendJson(res, 200, { ok: true, service: "xiu-online", uptime: Math.floor((Date.now() - startedAt) / 1000) });
    if (req.method === "POST" && route === "/api/register") {
      const body = await readBody(req);
      if (!registrationOpen()) return error(res, 403, "暂未开放注册");
      const username = validUsername(body.username), password = String(body.password || "");
      if (password.length < 6 || password.length > 128) return error(res, 400, "密码长度需为 6–128 位");
      if (q.byName.get(username)) return error(res, 409, "账号已存在");
      const salt = crypto.randomBytes(16).toString("hex");
      const isAdmin = db.prepare("SELECT COUNT(*) AS n FROM users").get().n === 0 ? 1 : 0;
      const result = db.prepare("INSERT INTO users(username,salt,password_hash,is_admin,created_at) VALUES(?,?,?,?,?)").run(username, salt, passwordHash(password, salt), isAdmin, Date.now());
      return sendJson(res, 201, { token: issueToken(Number(result.lastInsertRowid)), admin: !!isAdmin });
    }
    if (req.method === "POST" && route === "/api/login") {
      const body = await readBody(req); let username;
      try { username = validUsername(body.username); } catch { return error(res, 401, "账号或密码错误"); }
      const user = q.byName.get(username), password = String(body.password || "");
      const candidate = passwordHash(password, user?.salt || "00000000000000000000000000000000");
      if (!user || !equalHex(candidate, user.password_hash)) return error(res, 401, "账号或密码错误");
      return sendJson(res, 200, { token: issueToken(user.id), admin: !!user.is_admin });
    }
    if (req.method === "POST" && route === "/api/logout") {
      const token = String(req.headers["x-token"] || "");
      if (!userFor(req)) return error(res, 401, "登录已过期");
      db.prepare("DELETE FROM tokens WHERE token_hash=?").run(hashToken(token));
      return sendJson(res, 200, { ok: true });
    }

    const user = userFor(req);
    if (!user) return error(res, 401, "登录已过期，请重新登录");
    if (req.method === "GET" && route === "/api/session") {
      let data = getState(user.id);
      if (data) { data = getEngine(user.id).advance(data, Date.now()).state; persist(user.id, data); }
      return sendJson(res, 200, { data, serverNow: Date.now(), actions: [...ACTIONS], admin: !!user.is_admin });
    }
    if (req.method === "POST" && route === "/api/character") {
      const body = await readBody(req);
      if (q.save.get(user.id)) return error(res, 409, "角色已经创建");
      const name = [...String(body.name || "无名散修").trim().replace(/[^\p{L}\p{N}_·-]/gu, "")].slice(0, 12).join("") || "无名散修";
      const data = getEngine(user.id).createState(name); persist(user.id, data);
      return sendJson(res, 201, { data, serverNow: Date.now() });
    }
    if (req.method === "POST" && route === "/api/character/reset") {
      await readBody(req);
      db.prepare("DELETE FROM saves WHERE user_id=?").run(user.id);
      const online = clients.get(user.id);
      if (online) { clients.delete(user.id); online.socket.close(4004, "角色已重置"); }
      engines.delete(user.id);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && route === "/api/ws-ticket") {
      await readBody(req);
      return sendJson(res, 200, { ticket: createWsTicket(user.id), expiresIn: 30 });
    }
    if (req.method === "POST" && route === "/api/password") {
      const body = await readBody(req), oldPw = String(body.old || ""), newPw = String(body.new || "");
      if (newPw.length < 6 || newPw.length > 128) return error(res, 400, "新密码长度需为 6–128 位");
      if (!equalHex(passwordHash(oldPw, user.salt), user.password_hash)) return error(res, 403, "旧密码不正确");
      const salt = crypto.randomBytes(16).toString("hex");
      db.prepare("UPDATE users SET salt=?,password_hash=? WHERE id=?").run(salt, passwordHash(newPw, salt), user.id);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && route === "/api/save") return error(res, 410, "客户端存档上传已停用；状态由服务器结算和保存");

    if (req.method === "GET" && route === "/api/admin") {
      if (!user.is_admin) return sendJson(res, 200, { admin: false });
      return sendJson(res, 200, { admin: true, service: "xiu-online", version: await repoVersion(), log: readUpdateLog(), registrationOpen: registrationOpen(), startedAt });
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/reg") {
      const body = await readBody(req);
      db.prepare("INSERT INTO settings(key,value) VALUES('registration_open',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(body.open ? "true" : "false");
      return sendJson(res, 200, { ok: true, open: registrationOpen(), reg_open: registrationOpen() });
    }
    if (user.is_admin && req.method === "GET" && route === "/api/admin/users") {
      const rows = db.prepare("SELECT u.id,u.username,u.is_admin,u.created_at,s.updated_at FROM users u LEFT JOIN saves s ON s.user_id=u.id ORDER BY u.id").all();
      const list = rows.map(row => ({ id: row.id, username: row.username, admin: !!row.is_admin, created: Math.floor(row.created_at / 1000), updated: row.updated_at ? Math.floor(row.updated_at / 1000) : 0 }));
      return sendJson(res, 200, { list, reg_open: registrationOpen() });
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/user/del") {
      const body = await readBody(req), id = Number(body.id);
      if (!Number.isSafeInteger(id) || id === user.id) return error(res, 400, "不能删除该账号");
      db.prepare("DELETE FROM users WHERE id=?").run(id); engines.delete(id);
      const online = clients.get(id); if (online) { clients.delete(id); online.socket.close(4003, "账号已删除"); }
      return sendJson(res, 200, { ok: true });
    }
    if (user.is_admin && req.method === "GET" && route === "/api/admin/gifts") {
      const rows = db.prepare("SELECT code,payload,max_uses,used_count FROM gifts ORDER BY created_at DESC").all();
      const list = rows.map(row => ({ code: row.code, items: JSON.parse(row.payload).items || [], uses: row.max_uses, used: row.used_count }));
      return sendJson(res, 200, { list });
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/gift") {
      const body = await readBody(req), code = String(body.code || crypto.randomBytes(8).toString("hex").toUpperCase()).trim().slice(0, 64);
      const items = Array.isArray(body.items) ? body.items : (Array.isArray(body.payload?.items) ? body.payload.items : []);
      if (!items.length || items.length > 100) return error(res, 400, "礼包物品数量需为 1–100 件");
      for (const item of items) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return error(res, 400, "礼包物品格式无效");
        const count = Number(item.n || 1);
        if (!Number.isFinite(count) || count < 1 || count > 1_000_000 || (["eq", "fabao", "bp"].includes(item.c) && count > 100)) return error(res, 400, "礼包物品数量超过限制");
      }
      const payload = { items };
      const maxUses = Math.max(1, Math.min(100_000, Number(body.uses || body.max_uses || 1)));
      const expiresAt = body.expires_at ? Number(body.expires_at) : null;
      db.prepare("INSERT INTO gifts(code,payload,max_uses,expires_at,created_at) VALUES(?,?,?,?,?)").run(code, JSON.stringify(payload), maxUses, expiresAt, Date.now());
      return sendJson(res, 201, { ok: true, code });
    }
    if (user.is_admin && req.method === "POST" && route === "/api/admin/gift/del") {
      const body = await readBody(req); db.prepare("DELETE FROM gifts WHERE code=?").run(String(body.code || ""));
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && route === "/api/gift") {
      const body = await readBody(req), code = String(body.code || "").trim();
      const redeem = db.transaction(() => {
        const gift = db.prepare("SELECT * FROM gifts WHERE code=?").get(code), state = getState(user.id);
        if (!gift || !state || (gift.expires_at && gift.expires_at < Date.now()) || gift.used_count >= gift.max_uses) return false;
        if (db.prepare("SELECT 1 FROM gift_uses WHERE code=? AND user_id=?").get(code, user.id)) return false;
        const items = JSON.parse(gift.payload).items || [], playerEngine = getEngine(user.id);
        playerEngine.bindState(state, Date.now());
        const got = [], lost = [];
        for (const item of items) (playerEngine.G.giftGive(item) ? got : lost).push(playerEngine.G.giftLabel(item));
        const updatedState = playerEngine.G.s;
        playerEngine.G.log(`礼包码兑换成功，获得 ${got.join("、") || "无"}${lost.length ? `（背包已满，遗失 ${lost.join("、")}）` : ""}。`, "gold");
        persist(user.id, updatedState);
        db.prepare("INSERT INTO gift_uses(code,user_id,used_at) VALUES(?,?,?)").run(code, user.id, Date.now());
        db.prepare("UPDATE gifts SET used_count=used_count+1 WHERE code=?").run(code);
        const online = clients.get(user.id); if (online) { online.state = updatedState; send(online.socket, snapshot(online)); }
        return { items, got, lost, state: updatedState };
      });
      const result = redeem();
      return result ? sendJson(res, 200, { ok: true, ...result, serverNow: Date.now() }) : error(res, 400, "礼包码无效、已过期、已用完或已经兑换");
    }
    if (req.method === "POST" && route === "/api/admin/update") {
      await readBody(req);
      if (!user.is_admin) return error(res, 403, "只有管理员可以更新");
      // 写一个请求文件，由 root 的 xiu-online-web-update.path 监听并执行 xiu-online-update（Node 服务本身不提权）
      try { fs.rmSync(UPDATE_LOG, { force: true }); fs.writeFileSync(UPDATE_LOG, `>>> 已提交更新请求 ${new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}，等待更新服务启动…\n（一直停在这里：说明服务器还没装好网页更新服务，请在服务器上手动运行一次 sudo xiu-online-update）\n`); } catch {}
      try { fs.writeFileSync(UPDATE_TRIGGER, String(Date.now())); }
      catch (err) { return error(res, 500, "提交更新请求失败：" + err.message); }
      return sendJson(res, 200, { ok: true });
    }
    return error(res, 404, "接口不存在");
  } catch (err) {
    const status = Number(err.status) || 400;
    if (status >= 500) console.error(err?.stack || err);
    return error(res, status, err.message || "请求失败");
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD, perMessageDeflate: false });
function send(socket, value) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); }
function snapshot(client, logs = []) { return { type: "snapshot", state: client.state, serverNow: Date.now(), revision: client.revision, logs }; }
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://localhost"), ticket = url.searchParams.get("ticket") || "";
  const session = tickets.get(ticket);
  if (url.pathname !== WS_PATH || !allowedOrigin(req)) { socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return socket.destroy(); }
  if (!session || session.expiresAt < Date.now()) { tickets.delete(ticket); socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return socket.destroy(); }
  tickets.delete(ticket);
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, session));
});

wss.on("connection", (socket, session) => {
  const user = q.byId.get(session.userId);
  if (!user) { socket.close(4004, "账号不存在"); return; }
  const previous = clients.get(user.id);
  if (previous?.socket.readyState === WebSocket.OPEN) {
    try { persist(user.id, previous.state); } catch {}
    previous.socket.close(4001, "账号已在其他连接中进入");
  }
  const state = getState(user.id);
  if (!state) { socket.close(4004, "角色尚未创建"); return; }
  const playerEngine = getEngine(user.id);
  const advanced = playerEngine.advance(state, Date.now()); persist(user.id, advanced.state);
  const saved = q.save.get(user.id);
  const client = { socket, userId: user.id, engine: playerEngine, state: advanced.state, revision: saved?.revision || 1, lastPersist: Date.now(), rateWindow: Date.now(), rateCount: 0 };
  clients.set(user.id, client); receipts.set(socket, new Map());
  send(socket, snapshot(client, advanced.logs));

  socket.on("message", raw => {
    const now = Date.now();
    if (now - client.rateWindow >= 1000) { client.rateWindow = now; client.rateCount = 0; }
    if (++client.rateCount > 12) { send(socket, { type: "error", error: "操作过于频繁，请稍后重试" }); return; }
    let msg; try { msg = JSON.parse(raw.toString("utf8")); } catch { send(socket, { type: "error", error: "消息格式错误" }); return; }
    if (!msg || msg.type !== "action") { send(socket, { type: "error", error: "未知消息类型" }); return; }
    const id = String(msg.id || "");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) { send(socket, { type: "error", id, error: "操作编号无效" }); return; }
    const seen = receipts.get(socket);
    if (seen.has(id)) { send(socket, seen.get(id)); return; }
    try {
      const action = String(msg.action || ""), args = msg.args;
      if (!ACTIONS.has(action)) throw new Error("此操作未授权");
      if (!Array.isArray(args) || args.length > 20) throw new Error("操作参数无效");
      validateValue(args);
      const working = JSON.parse(JSON.stringify(client.state));
      const outcome = client.engine.act(working, action, args, Date.now());
      client.state = outcome.state;
      client.revision = (q.revision.get(user.id)?.revision || 0) + 1;
      persist(user.id, client.state); client.lastPersist = Date.now();
      const reply = { type: "result", id, ok: true, state: client.state, serverNow: outcome.serverNow, revision: client.revision, logs: outcome.logs, result: outcome.result };
      seen.set(id, reply); if (seen.size > 256) seen.delete(seen.keys().next().value); send(socket, reply);
    } catch (err) {
      const reply = { type: "result", id, ok: false, error: err.message || "操作失败", state: client.state, serverNow: Date.now(), revision: client.revision };
      seen.set(id, reply); if (seen.size > 256) seen.delete(seen.keys().next().value); send(socket, reply);
    }
  });
  socket.on("close", () => {
    if (clients.get(user.id)?.socket === socket) {
      try { persist(user.id, client.state); } catch (err) { console.error("final save failed", err); }
      clients.delete(user.id);
      engines.delete(user.id);
    }
  });
  socket.on("error", err => console.warn("WebSocket error:", err.message));
});

const timer = setInterval(() => {
  const now = Date.now();
  for (const [userId, client] of clients) {
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    try {
      const outcome = client.engine.advance(client.state, now); client.state = outcome.state;
      if (now - client.lastPersist >= 30_000) {
        persist(userId, client.state); client.lastPersist = now;
        client.revision = (q.revision.get(userId)?.revision || client.revision) + 1;
      }
      send(client.socket, snapshot(client, outcome.logs));
    } catch (err) { console.error("game tick failed:", err?.stack || err); client.socket.close(1011, "游戏结算失败"); }
  }
  for (const [ticket, item] of tickets) if (item.expiresAt < now) tickets.delete(ticket);
  for (const [userId, entry] of engines) if (!clients.has(userId) && now - entry.lastUsed > 120_000) engines.delete(userId);
  db.prepare("DELETE FROM tokens WHERE expires_at<?").run(now);
}, 1000);
timer.unref();

function shutdown(signal) {
  console.log(`Received ${signal}; flushing online player states.`);
  clearInterval(timer);
  for (const [id, client] of clients) { try { persist(id, client.state); client.socket.close(1001, "server shutdown"); } catch {} }
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
server.listen(PORT, HOST, () => {
  console.log(`xiu-online authoritative server listening on http://${HOST}:${PORT}`);
  console.log(`database: ${DB_FILE}`);
  console.log(`loaded ${validationEngine.G.modules.length} game modules; ${ACTIONS.size} whitelisted actions`);
});
