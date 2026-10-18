#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
问道长生 · 存档服务器
=====================
只用 Python 标准库，不需要安装任何依赖。

接口（全部返回 JSON）：
  POST /api/register  {"username","password"}   注册，返回 {"token"}
  POST /api/login     {"username","password"}   登录，返回 {"token"}
  GET  /api/save      Header X-Token             读取存档，返回 {"data", "updated"}
  POST /api/save      Header X-Token X-Sess，请求体 = 存档 JSON（null 表示删档）；X-Sess 不是最后进入游戏的会话号 → 409
                      网页关闭时 sendBeacon 不能带 Header：令牌、会话号放地址 /api/save?t=令牌&s=会话号
  GET  /api/admin         管理员信息：{admin, version, log}（log = 上次网页更新的输出）
  POST /api/admin/update  管理员：从 GitHub 更新游戏（等于在服务器上运行 sudo xiu-update）
  GET  /api/admin/gifts     管理员：礼包码列表 {list:[{code, items, uses, used, created}]}
  POST /api/admin/gift      管理员：生成礼包码 {code?, items, uses} → {code}（code 不填自动生成）
  POST /api/admin/gift/del  管理员：删除礼包码 {code}
  GET  /api/admin/users     管理员：账号列表 {reg_open, list:[{id, username, created, updated, admin}]}
  POST /api/admin/reg       管理员：开启 / 关闭注册 {open: true/false}
  POST /api/admin/user/del  管理员：删除账号 {id}（连同存档、登录令牌；管理员账号不能删）
  POST /api/password        修改密码 {old, new}（Header X-Token；改完其他设备要重新登录）
  POST /api/gift            兑换礼包码 {code} → {items}（每个账号每个码一次，次数用完失效）
                          管理员账号：环境变量 XIU_ADMIN（多个用逗号隔开），没设置就是第 1 个注册的账号

数据存在 SQLite：默认 /var/lib/xiu/xiu.db（环境变量 XIU_DB 可改）
监听地址：默认 127.0.0.1:18300（环境变量 XIU_HOST / XIU_PORT 可改），由 nginx 反向代理。
密码用 PBKDF2-SHA256 加盐哈希存储，不保存明文。
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB_PATH = os.environ.get("XIU_DB", "/var/lib/xiu/xiu.db")
HOST = os.environ.get("XIU_HOST", "127.0.0.1")
PORT = int(os.environ.get("XIU_PORT", "18300"))
MAX_BODY = 2 * 1024 * 1024           # 存档最大 2MB
TOKEN_DAYS = 90                      # 登录令牌有效期（天）
USERNAME_RE = re.compile(r"^[\w\u4e00-\u9fff]{2,20}$")  # 2~20 位字母/数字/下划线/中文
GIFT_RE = re.compile(r"^[A-Za-z0-9_\u4e00-\u9fa5]{2,32}$")

_lock = threading.Lock()
ADMINS = [x.strip() for x in os.environ.get("XIU_ADMIN", "").split(",") if x.strip()]
REPO_DIR = os.environ.get("XIU_DIR", "/opt/xiu")
UPDATE_LOG = os.path.join(os.path.dirname(DB_PATH), "update.log")


_dblock = threading.RLock()
_conn = None


class _DB:
    """全程共用一个 SQLite 连接（不再每个请求开关一次，省 CPU）；同一时间只给一个请求用，退出时自动提交。"""
    def __enter__(self):
        global _conn
        _dblock.acquire()
        try:
            if _conn is None:
                _conn = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
                _conn.row_factory = sqlite3.Row
                _conn.execute("PRAGMA synchronous=NORMAL")   # 配合 WAL：少刷盘，断电最多丢最后一次写入
                _conn.execute("PRAGMA cache_size=-2000")     # 缓存最多约 2MB，省内存
                _conn.execute("PRAGMA temp_store=MEMORY")
        except Exception:
            _dblock.release()
            raise
        return _conn

    def __exit__(self, et, ev, tb):
        try:
            if et:
                _conn.rollback()
            else:
                _conn.commit()
        finally:
            _dblock.release()


def db():
    return _DB()


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with db() as c:
        c.execute("PRAGMA journal_mode=WAL")   # 读写互不阻塞，存档写入更快（设置一次永久生效）
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            pw_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            created INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tokens(
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS saves(
            user_id INTEGER PRIMARY KEY,
            data TEXT,
            updated INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS gifts(
            code TEXT PRIMARY KEY,
            items TEXT NOT NULL,
            uses INTEGER NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS gift_used(
            code TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            at INTEGER NOT NULL,
            PRIMARY KEY(code, user_id)
        );
        CREATE TABLE IF NOT EXISTS sessions(
            user_id INTEGER PRIMARY KEY,
            sid TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings(
            k TEXT PRIMARY KEY,
            v TEXT
        );
        """)


def reg_open(conn):
    """是否允许注册（默认开启；还没有任何账号时总是允许，保证能注册第一个管理员）。"""
    row = conn.execute("SELECT v FROM settings WHERE k='reg_open'").fetchone()
    if not row or row["v"] != "0":
        return True
    return not conn.execute("SELECT 1 FROM users LIMIT 1").fetchone()


def hash_pw(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()


def new_token(conn, user_id):
    token = secrets.token_hex(24)
    conn.execute("INSERT INTO tokens(token,user_id,expires) VALUES(?,?,?)",
                 (token, user_id, int(time.time()) + TOKEN_DAYS * 86400))
    conn.execute("DELETE FROM tokens WHERE expires < ?", (int(time.time()),))
    return token


def user_by_token(conn, token):
    if not token:
        return None
    row = conn.execute("SELECT user_id FROM tokens WHERE token=? AND expires>?",
                       (token, int(time.time()))).fetchone()
    return row["user_id"] if row else None


def is_admin(conn, uid):
    if not uid:
        return False
    row = conn.execute("SELECT id, username FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        return False
    if ADMINS:
        return row["username"] in ADMINS
    first = conn.execute("SELECT MIN(id) AS m FROM users").fetchone()
    return row["id"] == first["m"]


def repo_version():
    try:
        out = subprocess.run(["git", "-c", "safe.directory=*", "-C", REPO_DIR, "log", "-1",
                              "--format=%h  %s  (%cd)", "--date=format:%Y-%m-%d %H:%M"],
                             capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or out.stderr.strip()
    except Exception as e:
        return str(e)


class Handler(BaseHTTPRequestHandler):
    server_version = "XiuServer/1.0"

    # ---------- 工具 ----------
    def send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_raw(self, code, body):
        """已经是 JSON 文本，直接发出去（读存档时不用先解析再编码一遍）。"""
        body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("存档过大")
        raw = self.rfile.read(n) if n else b"{}"
        return json.loads(raw.decode() or "{}")

    def route(self):
        # 兼容 /api/xxx 和 /xiuxian/api/xxx
        p = self.path.split("?")[0]
        return p[p.rfind("/api/") + 5:] if "/api/" in p else ""

    def log_message(self, fmt, *args):  # 只打印错误，不刷屏
        pass

    # ---------- GET ----------
    def do_GET(self):
        if self.route() == "admin/users":
            with db() as c:
                if not is_admin(c, user_by_token(c, self.headers.get("X-Token"))):
                    return self.send(403, {"error": "只有管理员可以查看"})
                rows = c.execute("SELECT u.id, u.username, u.created, s.updated FROM users u "
                                 "LEFT JOIN saves s ON s.user_id=u.id ORDER BY u.id").fetchall()
                lst = [{"id": r["id"], "username": r["username"], "created": r["created"], "updated": r["updated"] or 0,
                        "admin": is_admin(c, r["id"])} for r in rows]
                return self.send(200, {"reg_open": reg_open(c), "list": lst})
        if self.route() == "admin/gifts":
            with db() as c:
                if not is_admin(c, user_by_token(c, self.headers.get("X-Token"))):
                    return self.send(403, {"error": "只有管理员可以查看"})
                rows = c.execute("SELECT * FROM gifts ORDER BY created DESC").fetchall()
            return self.send(200, {"list": [{"code": r["code"], "items": json.loads(r["items"]), "uses": r["uses"],
                                             "used": r["used"], "created": r["created"]} for r in rows]})
        if self.route() == "admin":
            with db() as c:
                uid = user_by_token(c, self.headers.get("X-Token"))
                if not is_admin(c, uid):
                    return self.send(200, {"admin": False})
            log = ""
            try:
                with open(UPDATE_LOG, encoding="utf-8", errors="replace") as f:
                    log = f.read()[-4000:]
            except OSError:
                pass
            return self.send(200, {"admin": True, "version": repo_version(), "log": log})
        if self.route() != "save":
            return self.send(404, {"error": "not found"})
        with db() as c:
            uid = user_by_token(c, self.headers.get("X-Token"))
            if not uid:
                return self.send(401, {"error": "请重新登录"})
            row = c.execute("SELECT data, updated FROM saves WHERE user_id=?", (uid,)).fetchone()
            # 每次进入游戏发一个新的会话号；之前进入的设备（旧会话号）不能再上传存档，避免旧进度覆盖新进度
            sid = secrets.token_hex(8)
            c.execute("INSERT INTO sessions(user_id,sid) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET sid=excluded.sid", (uid, sid))
        if not row or row["data"] is None:
            return self.send(200, {"data": None, "sid": sid})
        return self.send_raw(200, '{"data":%s,"updated":%d,"sid":"%s"}' % (row["data"], row["updated"], sid))

    # ---------- POST ----------
    def post_save(self):
        """上传存档：请求体就是存档 JSON 本身（null = 删档），直接原样存进数据库，不解析再编码（省 CPU、省内存）。
        令牌 / 会话号放在 Header X-Token / X-Sess，sendBeacon 不能带 Header 时放地址里 ?t=令牌&s=会话号。"""
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            self.rfile.read(n)
            return self.send(400, {"error": "存档过大"})
        raw = (self.rfile.read(n) if n else b"").strip()
        q = dict(x.split("=", 1) for x in self.path.partition("?")[2].split("&") if "=" in x)
        token = self.headers.get("X-Token") or q.get("t")
        sid = self.headers.get("X-Sess") or q.get("s")
        if raw == b"null":
            save = None
        elif raw[:1] == b"{" and raw[-1:] == b"}":
            try:
                save = raw.decode("utf-8")
            except UnicodeDecodeError:
                return self.send(400, {"error": "存档格式错误"})
        else:
            return self.send(400, {"error": "存档格式错误"})
        with _lock, db() as c:
            uid = user_by_token(c, token)
            if not uid:
                return self.send(401, {"error": "请重新登录"})
            cur = c.execute("SELECT sid FROM sessions WHERE user_id=?", (uid,)).fetchone()
            if cur and cur["sid"] != sid:
                return self.send(409, {"error": "账号已在其他设备进入游戏"})
            c.execute("INSERT INTO saves(user_id,data,updated) VALUES(?,?,?) "
                      "ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated=excluded.updated",
                      (uid, save, int(time.time())))
        return self.send(200, {"ok": True})

    def do_POST(self):
        if self.route() == "save":
            return self.post_save()
        try:
            data = self.body()
        except Exception as e:
            return self.send(400, {"error": str(e) or "请求格式错误"})
        r = self.route()

        if r in ("register", "login"):
            u = str(data.get("username", "")).strip()
            p = str(data.get("password", ""))
            if not USERNAME_RE.match(u):
                return self.send(400, {"error": "账号需 2~20 位字母、数字、下划线或中文"})
            if len(p) < 6:
                return self.send(400, {"error": "密码至少 6 位"})
            with _lock, db() as c:
                row = c.execute("SELECT * FROM users WHERE username=?", (u,)).fetchone()
                if r == "register":
                    if not reg_open(c):
                        return self.send(403, {"error": "暂未开放注册"})
                    if row:
                        return self.send(409, {"error": "账号已存在"})
                    salt = secrets.token_hex(16)
                    cur = c.execute("INSERT INTO users(username,pw_hash,salt,created) VALUES(?,?,?,?)",
                                    (u, hash_pw(p, salt), salt, int(time.time())))
                    uid = cur.lastrowid
                else:
                    if not row or not hmac.compare_digest(row["pw_hash"], hash_pw(p, row["salt"])):
                        return self.send(401, {"error": "账号或密码错误"})
                    uid = row["id"]
                return self.send(200, {"token": new_token(c, uid)})

        if r == "password":
            old = str(data.get("old", "")); new = str(data.get("new", ""))
            if len(new) < 6:
                return self.send(400, {"error": "新密码至少 6 位"})
            token = self.headers.get("X-Token")
            with _lock, db() as c:
                uid = user_by_token(c, token)
                if not uid:
                    return self.send(401, {"error": "请重新登录"})
                row = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
                if not row or not hmac.compare_digest(row["pw_hash"], hash_pw(old, row["salt"])):
                    return self.send(400, {"error": "原密码错误"})
                salt = secrets.token_hex(16)
                c.execute("UPDATE users SET pw_hash=?, salt=? WHERE id=?", (hash_pw(new, salt), salt, uid))
                c.execute("DELETE FROM tokens WHERE user_id=? AND token<>?", (uid, token))
            return self.send(200, {"ok": True})

        if r in ("admin/reg", "admin/user/del"):
            with _lock, db() as c:
                if not is_admin(c, user_by_token(c, self.headers.get("X-Token"))):
                    return self.send(403, {"error": "只有管理员可以操作"})
                if r == "admin/reg":
                    c.execute("INSERT INTO settings(k,v) VALUES('reg_open',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
                              ("1" if data.get("open") else "0",))
                    return self.send(200, {"ok": True, "reg_open": bool(data.get("open"))})
                try:
                    tid = int(data.get("id"))
                except (TypeError, ValueError):
                    return self.send(400, {"error": "账号不对"})
                if not c.execute("SELECT 1 FROM users WHERE id=?", (tid,)).fetchone():
                    return self.send(404, {"error": "账号不存在"})
                if is_admin(c, tid):
                    return self.send(400, {"error": "管理员账号不能删除"})
                for t in ("tokens", "saves", "gift_used"):
                    c.execute(f"DELETE FROM {t} WHERE user_id=?", (tid,))
                c.execute("DELETE FROM users WHERE id=?", (tid,))
            return self.send(200, {"ok": True})

        if r in ("admin/gift", "admin/gift/del"):
            with _lock, db() as c:
                if not is_admin(c, user_by_token(c, self.headers.get("X-Token"))):
                    return self.send(403, {"error": "只有管理员可以操作"})
                if r == "admin/gift/del":
                    code = str(data.get("code", "")).strip()
                    c.execute("DELETE FROM gifts WHERE code=?", (code,))
                    c.execute("DELETE FROM gift_used WHERE code=?", (code,))
                    return self.send(200, {"ok": True})
                items = data.get("items")
                if not isinstance(items, list) or not items:
                    return self.send(400, {"error": "礼包里没有物品"})
                try:
                    uses = max(1, int(data.get("uses") or 1))
                except (TypeError, ValueError):
                    return self.send(400, {"error": "兑换次数不对"})
                code = str(data.get("code") or "").strip()
                if code and not GIFT_RE.match(code):
                    return self.send(400, {"error": "礼包码需 2~32 位字母、数字、下划线或中文"})
                if not code:
                    while True:
                        code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(16))
                        if not c.execute("SELECT 1 FROM gifts WHERE code=?", (code,)).fetchone():
                            break
                elif c.execute("SELECT 1 FROM gifts WHERE code=?", (code,)).fetchone():
                    return self.send(409, {"error": "礼包码已存在"})
                c.execute("INSERT INTO gifts(code,items,uses,used,created) VALUES(?,?,?,0,?)",
                          (code, json.dumps(items, ensure_ascii=False, separators=(",", ":")), uses, int(time.time())))
            return self.send(200, {"code": code})

        if r == "gift":
            code = str(data.get("code", "")).strip()
            with _lock, db() as c:
                uid = user_by_token(c, self.headers.get("X-Token"))
                if not uid:
                    return self.send(401, {"error": "请重新登录"})
                row = c.execute("SELECT * FROM gifts WHERE code=?", (code,)).fetchone()
                if not row:
                    return self.send(404, {"error": "礼包码不存在"})
                if c.execute("SELECT 1 FROM gift_used WHERE code=? AND user_id=?", (code, uid)).fetchone():
                    return self.send(409, {"error": "已经兑换过这个礼包码"})
                if row["used"] >= row["uses"]:
                    return self.send(409, {"error": "礼包码兑换次数已用完"})
                c.execute("UPDATE gifts SET used=used+1 WHERE code=?", (code,))
                c.execute("INSERT INTO gift_used(code,user_id,at) VALUES(?,?,?)", (code, uid, int(time.time())))
            return self.send(200, {"items": json.loads(row["items"])})

        if r == "admin/update":
            with db() as c:
                if not is_admin(c, user_by_token(c, self.headers.get("X-Token"))):
                    return self.send(403, {"error": "只有管理员可以更新"})
            try:   # 交给 root 运行的 xiu-web-update 服务（sudoers 只允许这一条命令）
                out = subprocess.run(["sudo", "-n", "systemctl", "start", "--no-block", "xiu-web-update.service"],
                                     capture_output=True, text=True, timeout=15)
            except Exception as e:
                return self.send(500, {"error": str(e)})
            if out.returncode != 0:
                return self.send(500, {"error": "启动更新失败：" + (out.stderr.strip() or "未知错误") +
                                       "。请先在服务器上运行一次 sudo xiu-update"})
            return self.send(200, {"ok": True})

        return self.send(404, {"error": "not found"})


if __name__ == "__main__":
    init_db()
    print(f"XiuServer listening on {HOST}:{PORT}, db={DB_PATH}", flush=True)
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    srv.daemon_threads = True   # 请求线程跟着主进程走，不留残余线程
    srv.serve_forever()
