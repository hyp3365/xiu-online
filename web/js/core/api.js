/* =====================================================================
 * 核心：服务器权威 API（账号、服务器状态与游戏指令）
 * ---------------------------------------------------------------------
 * 账号通过 HTTP 登录；角色状态、时间推进、随机结果和可改变状态的
 * 游戏操作均由 Node 服务处理。浏览器只显示服务器快照，不上传本地存档。
 * ===================================================================== */
const API = {
  BASE: "api/",
  token: localStorage.getItem("xiu_token") || "",
  user: localStorage.getItem("xiu_user") || "",
  actions: [],
  serverState: null,
  serverNow: 0,
  _clockPerf: 0,
  _clockInstalled: false,
  _wrapped: new Set(),
  _originalActions: new Map(),
  _pending: new Map(),
  _clickedButton: null,
  _clickTracking: false,
  _actionToastTimer: 0,
  _socket: null,
  _connectPromise: null,
  _reconnectTimer: null,
  _actionCounter: 0,

  async req(path, body, method) {
    const opt = { method: method || (body === undefined ? "GET" : "POST"), headers: { "Content-Type": "application/json" }, cache: "no-store" };
    if (this.token) opt.headers["X-Token"] = this.token;
    if (body !== undefined && body !== null) opt.body = typeof body === "string" ? body : JSON.stringify(body);
    const r = await fetch(this.BASE + path, opt);
    const j = await r.json().catch(() => ({ error: "服务器无响应" }));
    if (!r.ok) { const e = new Error(j.error || "请求失败 " + r.status); e.status = r.status; throw e; }
    return j;
  },

  setLogin(user, token) {
    this.user = user; this.token = token;
    localStorage.setItem("xiu_user", user); localStorage.setItem("xiu_token", token);
  },
  logout() {
    const token = this.token;
    if (token) fetch(this.BASE + "logout", { method: "POST", headers: { "Content-Type": "application/json", "X-Token": token }, body: "{}", keepalive: true }).catch(() => {});
    if (this._socket) this._socket.close(1000, "logout");
    this._socket = null;
    this.token = ""; this.serverState = null;
    localStorage.removeItem("xiu_token");
  },

  async register(u, p) { const j = await this.req("register", { username: u, password: p }); this.setLogin(u, j.token); },
  async login(u, p) { const j = await this.req("login", { username: u, password: p }); this.setLogin(u, j.token); },

  syncClock(serverNow) {
    if (!Number.isFinite(Number(serverNow))) return;
    this.serverNow = Number(serverNow);
    this._clockPerf = typeof performance !== "undefined" ? performance.now() : 0;
    if (!this._clockInstalled) {
      const api = this, nativeNow = Date.now.bind(Date);
      Date.now = function () {
        if (!api.serverNow) return nativeNow();
        const elapsed = typeof performance !== "undefined" ? performance.now() - api._clockPerf : 0;
        return Math.floor(api.serverNow + Math.max(0, elapsed));
      };
      this._clockInstalled = true;
    }
  },

  applyState(message) {
    if (!message || !message.state) return;
    this.syncClock(message.serverNow);
    this.serverState = message.state;
    if (typeof G !== "undefined") {
      const tab = G.tab;
      G.s = message.state;
      if (Number.isFinite(Number(message.state.last))) G._lastTick = Number(message.state.last);
      if (tab) G.tab = tab;
      G.dirty();
      if (!G._stopped) { G.render(); G.renderLog(); G.bars(); }
    }
  },

  installActions(names) {
    this.actions = Array.isArray(names) ? names.filter(x => typeof x === "string") : [];
    this.trackButtonClicks();
    for (const name of this.actions) {
      if (this._wrapped.has(name) || typeof G[name] !== "function") continue;
      const original = G[name];
      this._originalActions.set(name, original);
      G[name] = (...args) => this.sendAction(name, this.captureActionArgs(name, args)).catch(error => {
        if (G && typeof G.log === "function") G.log(error.message || "服务器操作失败", "bad");
        return false;
      });
      this._wrapped.add(name);
    }
  },

  trackButtonClicks() {
    if (this._clickTracking || typeof document === "undefined") return;
    document.addEventListener("click", event => {
      const button = event.target && event.target.closest ? event.target.closest("button") : null;
      if (!button) return;
      this._clickedButton = button;
      // 必须用 setTimeout（宏任务）清除：真实点击时，捕获监听器返回后浏览器会立刻跑微任务，
      // 用 Promise.resolve().then 会在按钮自己的 onclick 执行前就把记录清掉，
      // 导致按钮没有“处理中”状态、data-refresh 弹窗也不会刷新。
      setTimeout(() => { if (this._clickedButton === button) this._clickedButton = null; }, 0);
    }, true);
    this._clickTracking = true;
  },

  markButtonPending(button) {
    if (!button || button.disabled) return { button: null, wasDisabled: true };
    button.classList.add("pending");
    button.disabled = true;
    return { button, wasDisabled: false };
  },

  finishButtonPending(pending) {
    if (!pending || !pending.button) return;
    pending.button.classList.remove("pending");
    if (pending.button.isConnected && !pending.wasDisabled) pending.button.disabled = false;
  },

  showActionFeedback(text, tone = "sys") {
    this.setSync(text);
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = text;
    toast.dataset.tone = tone;
    toast.classList.add("show");
    clearTimeout(this._actionToastTimer);
    this._actionToastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  },

  captureActionArgs(name, args) {
    const value = selector => document.querySelector(selector)?.value;
    const out = [...args];
    if (name === "cultSetSave") {
      if (out[1] === undefined) out[1] = value("#cs-low");
      if (out[2] === undefined) out[2] = value("#cs-high");
    }
    if (name === "startChuqiao" && out[2] === undefined) out[2] = value("#cq-n");
    if (name === "buyMat" && out[2] === undefined) out[2] = value("#shop-n");
    if (name === "exchangeMat" && out[2] === undefined) out[2] = value("#tr-n");
    return out;
  },

  async loadSave() {
    const j = await this.req("session");
    this.syncClock(j.serverNow);
    this.installActions(j.actions || []);
    this.serverState = j.data || null;
    if (j.data) await this.connectSocket();
    return j.data;
  },

  async createCharacter(name) {
    const j = await this.req("character", { name: String(name || "无名散修").slice(0, 12) });
    this.serverState = j.data;
    this.syncClock(j.serverNow);
    await this.connectSocket();
    return j.data;
  },

  async connectSocket() {
    if (!this.token) throw new Error("请先登录");
    if (this._socket && this._socket.readyState === WebSocket.OPEN) return;
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = (async () => {
      const { ticket } = await this.req("ws-ticket", {}, "POST");
      const u = new URL(this.BASE + "ws", location.href);
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.searchParams.set("ticket", ticket);
      const socket = new WebSocket(u.toString());
      this._socket = socket;
      await new Promise((resolve, reject) => {
        let opened = false;
        const timeout = setTimeout(() => { if (!opened) { socket.close(); reject(new Error("连接游戏服务器超时")); } }, 10_000);
        socket.onopen = () => { opened = true; clearTimeout(timeout); resolve(); this.setSync("已连接服务器"); };
        socket.onerror = () => { if (!opened) { clearTimeout(timeout); reject(new Error("无法连接游戏服务器")); } };
      });
      socket.onmessage = event => this.onSocketMessage(event.data);
      socket.onclose = event => {
        if (this._socket === socket) this._socket = null;
        for (const [id, pending] of this._pending) {
          clearTimeout(pending.timer); this.finishButtonPending(pending);
          pending.reject(new Error("与服务器断开连接，请重试")); this._pending.delete(id);
        }
        if (event.code === 4001 && typeof G !== "undefined" && G.kicked) G.kicked();
        else if (this.token && this.serverState && event.code !== 1000) {
          this.setSync("连接中断，正在重连…");
          this.showActionFeedback("连接中断，正在重连…", "bad");
          clearTimeout(this._reconnectTimer);
          this._reconnectTimer = setTimeout(() => this.connectSocket().catch(() => {}), 1500);
        }
      };
    })();
    try { await this._connectPromise; } finally { this._connectPromise = null; }
  },

  onSocketMessage(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message.type === "snapshot") {
      this.applyState(message);
      this.setSync("已同步到服务器");
      return;
    }
    if (message.type === "error" && !message.id) {
      this.showActionFeedback(message.error || "服务器操作失败", "bad"); return;
    }
    if (message.type !== "result") return;
    const pending = this._pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer); this._pending.delete(message.id);
    this.finishButtonPending(pending);
    this.applyState(message);
    if (!message.ok) {
      const error = message.error || "操作失败";
      this.showActionFeedback(error, "bad");
      pending.reject(new Error(error)); return;
    }
    this.afterRemoteAction(pending.name, pending.args, pending.refresh, message.result);
    pending.resolve(message);
  },

  afterRemoteAction(name, args, refresh, result) {
    // These actions combine a server state change with a purely visual transition.
    if (name === "startTrib") { G.tribOpen = true; if (G.tribRender) G.tribRender(true); }
    if (name === "tribPut") { G.closeModal(); if (G.tribOpen && G.tribRender) G.tribRender(true); }
    if (name === "tribUse" && G.tribRender) G.tribRender(false);
    if (name === "startChuqiao") { G.closeModal(); G.exploreOpen = true; G.render(); }
    if (["autoTaskSet", "atPickSet"].includes(name) && G.openCultSet) G.openCultSet();
    if (["learnBook", "learnGfBook", "learnBlueprint", "learnRingBp", "installFurnace", "equipItem", "unequip", "sellItem", "slotSpell", "swapFabao", "unslotSpell", "useStone", "useFurnace", "eatDan", "eatQl", "plantField", "clearField"].includes(name) && G.closeModal) G.closeModal();
    if (name === "craftFurnace" && args[2] === "fabao" && G.closeModal) G.closeModal();
    if (name === "spellJy" && G.openSpellJy) G.openSpellJy(args[0]);
    if (name === "doEnhance" && G.openEnhance) G.openEnhance(args[0]);
    if (name === "doReset" && G.openReset) { G._locks = Array.isArray(result && result.locks) ? result.locks : G._locks || []; G.openReset(args[0]); }
    if (refresh && typeof G[refresh] === "function") G[refresh]();
    if (name === "closeTrib") {
      G.tribOpen = false;
      const trib = document.getElementById("trib");
      if (trib) { trib.classList.add("hidden"); trib.innerHTML = ""; }
      G.render();
    }
    if (name === "skipBattle") G.render();
  },

  async sendAction(name, args) {
    const button = this._clickedButton;
    this._clickedButton = null;
    const buttonPending = this.markButtonPending(button);
    const refresh = button && button.dataset ? button.dataset.refresh || "" : "";
    try {
      if (!this._socket || this._socket.readyState !== WebSocket.OPEN) await this.connectSocket();
    } catch (error) {
      this.finishButtonPending(buttonPending);
      this.showActionFeedback(error.message || "无法连接游戏服务器", "bad");
      throw error;
    }
    const socket = this._socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.finishButtonPending(buttonPending);
      const error = new Error("游戏服务器暂不可用");
      this.showActionFeedback(error.message, "bad");
      throw error;
    }
    const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now().toString(36)}-${(++this._actionCounter).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this._pending.get(id);
        this._pending.delete(id); this.finishButtonPending(pending);
        const error = new Error("服务器响应超时，请稍后查看状态");
        this.showActionFeedback(error.message, "bad"); reject(error);
      }, 15_000);
      this._pending.set(id, { resolve, reject, timer, name, args, refresh, ...buttonPending });
      try { socket.send(JSON.stringify({ type: "action", id, action: name, args })); }
      catch (error) {
        clearTimeout(timer); this._pending.delete(id); this.finishButtonPending(buttonPending);
        this.showActionFeedback(error.message || "发送操作失败", "bad"); reject(error);
      }
    });
  },

  async upload() { throw new Error("客户端存档上传已关闭，所有进度保存在服务器"); },
  beacon() {},
  async resetCharacter() { return this.req("character/reset", {}, "POST"); },

  // 管理员与账号 API
  async adminInfo() { return this.req("admin"); },
  async adminUpdate() { return this.req("admin/update", {}); },
  async giftList() { return this.req("admin/gifts"); },
  async giftCreate(d) { return this.req("admin/gift", d); },
  async giftDelete(code) { return this.req("admin/gift/del", { code }); },
  async giftRedeem(code) { const j = await this.req("gift", { code }); if (j.state) this.applyState(j); return j; },
  async changePassword(oldPw, newPw) { return this.req("password", { old: oldPw, new: newPw }); },
  async userList() { return this.req("admin/users"); },
  async setRegOpen(open) { return this.req("admin/reg", { open }); },
  async userDelete(id) { return this.req("admin/user/del", { id }); },
  setSync(text) { const el = document.getElementById("sync"); if (el) el.textContent = text; },
};
