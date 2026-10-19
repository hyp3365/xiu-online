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
  _seq: 0,
  // 开关 / 设置类操作：先在本地改好显示，服务器结果到了再以服务器为准（失败会自动恢复）。
  OPTIMISTIC: new Set(["toggleAuto", "toggleAutoPill", "toggleBodyAuto", "toggleRefill", "bsetToggle", "bsetMove", "bsetFoe", "bsetRound", "bsetSet", "autoTaskSet", "cultSetSave", "atPickSet"]),

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
    // 时钟只往前平滑校准：快照路上的网络延迟每次不同，直接覆盖会让时间前后跳，进度条一顿一顿。
    // 差距超过 1.5 秒（首次同步、休眠恢复）才直接重设。
    const perf = typeof performance !== "undefined" ? performance.now() : 0;
    if (this.serverNow) {
      const cur = this.serverNow + (perf - this._clockPerf), next = Number(serverNow);
      if (Math.abs(next - cur) <= 1500 && next <= cur) return;
    }
    this.serverNow = Number(serverNow);
    this._clockPerf = perf;
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

  // 应用服务器补丁（格式见 server.mjs 的 diffState）
  patchState(target, patch) {
    if (!patch || patch.$p !== 1 || !target || typeof target !== "object" || Array.isArray(target)) return patch;
    for (const k of patch.d || []) delete target[k];
    for (const [k, v] of Object.entries(patch.s || {})) target[k] = v && v.$p === 1 ? this.patchState(target[k], v) : v;
    return target;
  },

  applyState(message) {
    if (!message) return;
    if (message.state) this.serverState = message.state;
    else if ("patch" in message) {
      // 序号对不上（漏了消息）就请服务器重发完整状态
      if (!this.serverState || message.base !== this._seq) {
        if (this._socket && this._socket.readyState === WebSocket.OPEN) this._socket.send(JSON.stringify({ type: "resync" }));
        return;
      }
      if (message.patch) this.serverState = this.patchState(this.serverState, message.patch);
    } else return;
    if (message.seq) this._seq = message.seq;
    this.syncClock(message.serverNow);
    if (typeof G !== "undefined") {
      const tab = G.tab;
      // 界面用副本：本地先显示的改动不会污染服务器基准状态
      G.s = JSON.parse(JSON.stringify(this.serverState));
      const state = G.s;
      if (Number.isFinite(Number(state.last))) G._lastTick = Number(state.last);
      if (tab) G.tab = tab;
      G.dirty();
      if (!G._stopped) { G.render(); G.renderLog(); G.bars(); }
    }
  },

  // 记住最近一次打开弹窗的函数：服务器操作完成后弹窗还开着，就用新状态重新打开它，
  // 弹窗里的按钮、数量、状态立即刷新（以前只有少数弹窗会刷新）。
  trackModalOpeners() {
    if (this._modalTracking || typeof G === "undefined") return;
    this._modalTracking = true;
    const modal = G.modal;
    G._modalSeq = 0;
    // 不是 open* 打开的弹窗（如悟道结果）不记录打开函数，避免被刷新成上一个弹窗
    G.modal = function (...args) { G._modalSeq++; G._modalOpener = null; return modal.apply(this, args); };
    const closeModal = G.closeModal;
    G.closeModal = function (...args) { G._modalOpener = null; return closeModal.apply(this, args); };
    for (const key of Object.keys(G)) {
      const fn = G[key];
      if (!/^open[A-Z]/.test(key) || typeof fn !== "function" || this._wrapped.has(key) || fn.constructor.name === "AsyncFunction") continue;
      G[key] = function (...args) {
        const before = G._modalSeq, result = fn.apply(this, args);
        if (G._modalSeq !== before) G._modalOpener = { key, fn, args };
        return result;
      };
    }
  },

  refreshOpenModal() {
    const m = typeof G !== "undefined" && G._modalOpener, el = document.getElementById("modal"), box = document.getElementById("modal-box");
    if (!m || G._lockModal || G._cfgOpen || !el || el.classList.contains("hidden")) return;
    const top = box ? box.scrollTop : 0;
    try { m.fn.apply(G, m.args); G._modalOpener = m; } catch { return; }
    if (box) box.scrollTop = top;
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
    this.trackModalOpeners();
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

  // 按钮不再显示「处理中…」：结果由服务器很快推回，界面直接刷新
  markButtonPending() { return { button: null }; },
  finishButtonPending() {},

  // 服务器写的游戏日志（如「灵石不足」）：和单机版 G.log 一样，不在修炼页（或开着弹窗）时用浮动提示显示
  toastLogs(logs, force = false) {
    if (!Array.isArray(logs) || !logs.length || typeof G === "undefined") return;
    const modal = document.getElementById("modal"), modalOpen = modal && !modal.classList.contains("hidden");
    if (!force && G.tab === "cultivate" && !modalOpen) return;
    const t = document.getElementById("toast"); if (!t) return;
    const esc = x => String(x).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    t.innerHTML = logs.slice(0, 3).reverse().map(l => `<p class="${esc(l.c || "")}">${esc(l.m || "")}</p>`).join("");
    t.classList.add("show");
    clearTimeout(G._toastT); clearTimeout(this._actionToastTimer);
    G._toastT = setTimeout(() => t.classList.remove("show"), 1800);
  },

  // 需要玩家确认的操作：先在本地弹确认框，取消就不发给服务器（服务器端 confirm 一律视为确定）
  CONFIRMS: {
    leaveSect: () => G.s.sect && G.s.contrib >= G.leaveCost() ? `叛出门派将扣除贡献 ${U.fmt(G.leaveCost())}、清空职务（已学功法保留），确定？` : "",
    stopStudy: () => G.s.gfStudy ? "中断修炼，已消耗的灵气不退还，确定？" : "",
    svFire: () => "遣散这个道童？",
    forgetGongfa: id => {
      const g = G.s.gongfa[id] && DATA.skillInfo(id, G.s.gongfa[id]);
      return g && G.ssForgettable(id) ? `遗忘《${g.name}》？\n第 ${g.lv} 层和加的${g.label}全部删除，归还灵识点 ${G.ssCost(id)}。` : "";
    },
  },

  showActionFeedback(text, tone = "sys") {
    this.setSync(text);
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = text;
    toast.dataset.tone = tone;
    toast.classList.add("show");
    clearTimeout(this._actionToastTimer);
    this._actionToastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
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
          // 后台静默重连，不在前台弹提示
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
      this.toastLogs(message.logs);
      this.setSync("已同步到服务器");
      return;
    }
    if (message.type === "config") {
      // 管理员改了游戏参数：重新加载网页拿新参数（正在编辑参数的管理员等关闭窗口再加载）
      if (typeof G !== "undefined" && G._cfgOpen) { G._cfgReload = true; return; }
      this.showActionFeedback("游戏参数已更新，正在重新加载…");
      setTimeout(() => location.reload(), 1200); return;
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
    this.afterRemoteAction(pending.name, pending.args, pending.refresh, message.result, pending.exStart, message.logs || []);
    if (pending.name !== "wudaoDone") this.toastLogs(message.logs, true);
    pending.resolve(message);
  },

  afterRemoteAction(name, args, refresh, result, exStart, logs = []) {
    // 悟道结果窗口：服务器结算后用它写的日志在本地弹出
    if (name === "wudaoDone") {
      const D0 = ((CFG.wudaoRoom || {}).daos || []).find(d => d.id === args[0]), log = logs.find(l => l.c === "gold");
      if (D0 && log && G.wdModal) G.wdModal(D0, String(log.m).replace(/。$/, "").split("，").slice(1).map(x => `<div class="line"><div>${x.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</div></div>`).join(""));
    }
    // 开始探索 / 挖矿 / 秘境后展开探索信息（单机版在操作里设置 exploreOpen，服务器上设置不到客户端）
    if (["toggleExplore", "toggleKuang", "toggleMj", "mjAll"].includes(name) && G.s.explore && G.s.explore.start !== exStart) { G.exploreOpen = true; G.render(); }
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
    else this.refreshOpenModal();
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
    if (typeof G !== "undefined" && G.s) {
      // 炼法宝还没选类型 / 属性：在本地打开选择窗口，选好后再发给服务器
      if (name === "craftFurnace" && args[2] === "fabao" && !(DATA.fabaoTypes[args[3]] && DATA.elById[args[4]])) { G.openFabaoPick(args[1]); return false; }
      // 悟道：读条动画在本地播放，结束时让服务器结算
      if (name === "wudao") {
        const dao = args[0];
        if (G._wdRun || !G.wdCheck(dao)) { G.renderLog(); return false; }
        const ms = ((CFG.wudaoRoom || {}).TIME || 0) * 1000;
        G._wdRun = { dao, end: Date.now() + ms }; G.render();
        await new Promise(r => setTimeout(r, ms));
        G._wdRun = null; G._wdFx = Date.now();
        return this.sendAction("wudaoDone", [dao]);
      }
      if (this.CONFIRMS[name]) {
        let text = "";
        try { text = this.CONFIRMS[name](...args); } catch {}
        if (text && !confirm(text)) return false;
      }
    }
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
    if (this.OPTIMISTIC.has(name) && typeof G !== "undefined" && G.s) {
      try { this._originalActions.get(name).apply(G, args); G.dirty(); G.render(); G.bars(); } catch {}
    }
    const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now().toString(36)}-${(++this._actionCounter).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this._pending.get(id);
        this._pending.delete(id); this.finishButtonPending(pending);
        const error = new Error("服务器响应超时，请稍后查看状态");
        this.showActionFeedback(error.message, "bad"); reject(error);
      }, 15_000);
      const exStart = typeof G !== "undefined" && G.s && G.s.explore ? G.s.explore.start : undefined;
      this._pending.set(id, { resolve, reject, timer, name, args, refresh, exStart, ...buttonPending });
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
