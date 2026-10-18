/* =====================================================================
 * 核心：游戏主体 G
 * ---------------------------------------------------------------------
 * 所有玩法都写成“模块”，放在 js/modules/ 下，用 G.module({...}) 注册：
 *
 *   G.module({
 *     id: "liandan",                 // 模块名
 *     tab: "liandan",                // （可选）底部标签对应的页面
 *     defaults: () => ({ ... }),     // （可选）新存档时该模块需要的字段
 *     tick(offline) { ... },         // （可选）每 10 秒执行一次；离线也会补算
 *     view() { return "<html>"; },   // （可选）页面内容
 *   });
 *
 * 每 10 秒 G 会依次调用所有模块的 tick()。
 * 打开网页时，会按“离开的时间 ÷ 10 秒”把 tick 全部补算一遍，
 * 所以以后加炼丹、炼器，只要写在 tick 里，离线就会自动继续进行。
 * ===================================================================== */
const G = {
  s: null,             // 当前存档（整个游戏状态都在这里，会存到服务器）
  modules: [],         // 已注册的模块
  views: {},           // 标签页 → 渲染函数
  tab: "cultivate",    // 当前底部标签
  silent: false,       // 离线补算时为 true，不刷新界面
  _ver: 0, _cache: null,
  _lastTick: 0, _lastUpload: 0, _dirtySave: false,

  /* ---------- 模块注册 ---------- */
  module(m) {
    this.modules.push(m);
    if (m.tab && m.view) this.views[m.tab] = m.view;
    if (m.api) Object.assign(this, m.api); // 模块对外的函数挂到 G 上，按钮用 G.xxx() 调用
  },

  /* ---------- 属性缓存：状态变化后调用 dirty() 让属性重新计算 ---------- */
  dirty() { this._ver++; this._cache = null; },
  calc() {
    if (!this._cache) {
      this._cache = { stats: this.computeStats() };   // 先算属性
      this._cache.speed = this.computeSpeed();         // 修炼速度依赖属性（神识）
    }
    return this._cache;
  },
  stats() { return this.calc().stats; },
  speed() { return this.calc().speed; },

  /* ---------- 当前时间 ----------
   * 离线补算时返回“模拟时间”，所以按时间计算的功能（功法参悟、事务堂）
   * 写成 G.now() 而不是 Date.now()，离线就能正确补算。 */
  _simNow: 0,
  now() { return this._simNow || Date.now(); },

  /* ---------- 日志 ---------- */
  log(m, c = "") {
    if (this.silent) return;
    this.s.log.unshift({ m, c });
    if (this.s.log.length > 60) this.s.log.length = 60;
    this.renderLog();
    // 信息栏只在修炼页显示，其他页面用浮动提示
    if (this.tab !== "cultivate") {
      const t = $("#toast"); if (!t) return;
      t.innerHTML = `<p class="${c}">${m}</p>`; t.classList.add("show");
      clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove("show"), 2500);
    }
  },

  /* ---------- 存档 ---------- */
  newSave(name) {
    let s = { v: 5, name, last: Date.now(), log: [] };
    for (const m of this.modules) if (m.defaults) Object.assign(s, m.defaults());
    s._nm = DATA.nmSnap();   // 新存档记下当前用的名字（config/names.js），以后改名读档时对照
    return s;
  },
  // 存档缺字段时，用模块默认值补上（以后加新功能不会坏档）
  migrate(s) {
    DATA.nmMigrate(s);   // 存档里的旧名字 → config/names.js 的新名字
    for (const m of this.modules) if (m.defaults) {
      const d = m.defaults();
      for (const k in d) if (s[k] === undefined) s[k] = d[k];
    }
    return s;
  },
  save(force) {
    if (this._stopped) return;
    this.s.last = this._lastTick || Date.now();   // v208 存上次结算的时间（不是现在）：离线补算从这里接着算，不丢不足 10 秒的聚灵
    this._saveStr = JSON.stringify(this.s);   // 只转换一次：本地备份和上传服务器用同一份
    localStorage.setItem("xiu_local_" + API.user, this._saveStr); // 本地备份
    this._dirtySave = true;
    if (force || Date.now() - this._lastUpload > 30000) this.upload();
  },
  async upload() {
    if (!API.token || !this._dirtySave) return;
    this._dirtySave = false; this._lastUpload = Date.now();
    try { await API.upload(this._saveStr || JSON.stringify(this.s)); this.setSync("已同步"); }
    catch (e) {
      if (e.status === 409) return this.kicked();
      this._dirtySave = true; this.setSync("同步失败"); if (/登录/.test(e.message)) this.relogin();
    }
  },
  // 账号在别的设备进入了游戏：本设备停止运行和上传，点按钮重新读取服务器上的最新进度
  kicked() {
    this._stopped = true; this._lockModal = true;
    this.modal(`<h2>已在其他设备登录</h2><p>账号已在其他设备进入游戏，本设备已暂停。</p><div class="btns"><button class="primary" onclick="location.reload()">重新进入</button></div>`);
  },
  setSync(t) { const el = $("#sync"); if (el) el.textContent = t; },

  /* ---------- 每 10 秒的结算 ---------- */
  tickAll(offline) {
    for (const m of this.modules) if (m.tick) m.tick.call(this, offline);
  },

  // 离线补算：离开多久就补多久，不封顶
  offline() {
    const sec = (Date.now() - this.s.last) / 1000;
    let n = Math.floor(sec / DATA.TICK);
    if (n < 1) return;
    const before = { exp: this.s.exp, ling: this.s.ling, stone: this.s.stone, contrib: this.s.contrib || 0, kills: this.s.kills || 0, bag: this.bagCount() };
    // 离线账本：探索结算（world.js giveLoot）、事务堂（sect.js affairReward）往这里记
    this._off = { exRuns: 0, exStone: 0, exItems: {}, exLost: 0, afN: 0, afStone: 0, afContrib: 0, cq: { runs: 0, stone: 0, exItems: {} }, allItems: {}, learn: [], gfUp: {} };   // v173 出窍、学会、功法升层
    this.silent = true;
    const MAX = 3e6; // 安全上限（约 347 天），防止浏览器卡死
    const runs = Math.min(n, MAX);
    const t0 = this.s.last;
    this.runTicks(t0, runs);   // 见 core/fastsim.js：事件之间的纯数值结算直接计算，结果和逐个结算一样
    this.silent = false;
    this.s.last = Date.now() - (sec % DATA.TICK) * 1000;
    const o = this._off; this._off = null;
    this.offlineReport(sec, before, o);
    this.dirty();
  },
  // 背包里每种物品的数量（按名字），用来算离线新增
  bagCount() { const m = {}; for (const it of this.s.bag) { const k = this.itemName(it); m[k] = (m[k] || 0) + (it.n || 1); } return m; },
  // 离线收益明细：写进信息栏 + 弹窗
  offlineReport(sec, b, o) {
    const s = this.s, f = U.fmt, sign = v => (v >= 0 ? "+" : "-") + f(Math.abs(v)), rows = [];
    const dExp = s.exp - b.exp, dStone = s.stone - b.stone, dContrib = (s.contrib || 0) - b.contrib, dLing = s.ling - b.ling;
    rows.push(`<b>总计</b>`);
    rows.push(`修为 ${sign(dExp)}　灵石 ${sign(dStone)}　灵气 ${sign(dLing)}${s.sect || dContrib ? `　贡献 ${sign(dContrib)}` : ""}`);
    const items = m => Object.keys(m).map(k => `${k}×${f(m[k])}`).join("、"), kills = (s.kills || 0) - b.kills, cqOn = s.explore && s.explore.cq;
    if (o.learn.length) { rows.push(`<b>学会</b>`); rows.push(o.learn.join("、")); }   // v173 学了什么
    const ups = Object.keys(o.gfUp); if (ups.length) { rows.push(`<b>功法升层</b>`); rows.push(ups.map(k => `${k} 第 ${o.gfUp[k]} 层`).join("、")); }
    if (o.exRuns || (s.explore && !cqOn)) {
      rows.push(`<b>自动探索</b>`);
      rows.push(`结算 ${o.exRuns} 次${o.cq.runs ? "" : `，击败 ${f(kills)} 只`}，灵石 +${f(o.exStone)}${items(o.exItems) ? "<br>" + items(o.exItems) : ""}`);
    }
    if (o.cq.runs || cqOn) {   // v173 出窍单独显示
      rows.push(`<b>元婴出窍</b>`);
      rows.push(`探索 ${o.cq.runs} 次${o.exRuns ? "" : `，击败 ${f(kills)} 只`}，灵石 +${f(o.cq.stone)}${items(o.cq.exItems) ? "<br>" + items(o.cq.exItems) : ""}`);
    }
    if (o.exRuns && o.cq.runs) rows.push(`探索和出窍共击败 ${f(kills)} 只`);
    if (o.exLost) rows.push(`<span class="bad">背包已满，遗失 ${o.exLost} 件</span>`);
    if (s.explore && s.explore.step) rows.push(`当前这次已走 ${s.explore.step} 步，收获在走完后结算`);
    if (!s.explore && (o.exRuns || o.cq.runs)) rows.push(`<span class="bad">离线期间${o.cq.runs && !o.exRuns ? "出窍" : "自动探索"}已结束（次数用完、生命不足或战败）</span>`);
    if (o.afN) { rows.push(`<b>事务堂</b>`); rows.push(`完成 ${f(o.afN)} 轮，灵石 +${f(o.afStone)}，贡献 +${f(o.afContrib)}`); }
    const other = dStone - o.exStone - o.cq.stone - o.afStone;
    if (other) rows.push(`<b>其他灵石</b>`, `${sign(other)}（自动补充灵气、种田、炼制等收支）`);
    // 背包新增（探索以外：灵药园收获、炼丹、炼器出炉等）
    const now = this.bagCount(), gain = [];
    for (const k in now) { const d = now[k] - (b.bag[k] || 0) - (o.allItems[k] || 0); if (d > 0) gain.push(`${k}×${f(d)}`); }
    if (gain.length) rows.push(`<b>其他新增物品</b>`, gain.join("、"));
    const short = [`修为 ${sign(dExp)}`, `灵石 ${sign(dStone)}`]; if (o.exRuns) short.push(`探索 ${o.exRuns} 次`); if (o.cq.runs) short.push(`出窍 ${o.cq.runs} 次`); if (o.learn.length) short.push(`学会 ${o.learn.join("、")}`); if (o.afN) short.push(`事务堂 ${o.afN} 轮`);
    this.log(`你离开了 ${U.dur(sec)}，离线收益：${short.join("，")}。`, "gold");
    this.lastOffline = rows;
    try { this.modal(`<h2>离线 ${U.dur(sec)}</h2><div class="explore-log">${rows.map(r => `<p>${r}</p>`).join("")}</div><div class="btns"><button onclick="G.closeModal()">关闭</button></div>`); } catch (e) {}
  },

  /* ---------- 主循环（每 0.2 秒检查一次） ---------- */
  loop() {
    if (this._stopped || this._hold) return;   // v245 刚切回前台：先让画面显示出来，再补算离开期间的结算
    const now = Date.now(), T = DATA.TICK * 1000;
    if (now - this._lastTick >= T) {
      // 浏览器切到后台会暂停/降频定时器：按实际经过时间补齐漏掉的结算，不再丢修为、气血、灵气
      const n = Math.min(Math.floor((now - this._lastTick) / T), 3e6);
      if (n > 1) {
        this.silent = true;
        try { this.runTicks(this._lastTick, n - 1); }
        finally { this._simNow = 0; this.silent = false; }
        this.dirty();
      }
      this._lastTick = now - (now - this._lastTick) % T;
      this.tickAll(false);
      this.save();
      this.render();
    }
    this.bars();
  },

  // 进度条：每一帧按时间直接算宽度（不用 CSS 过渡），页面每秒重绘也不会一顿一顿
  bars() {
    if (!this.s) return;
    const now = Date.now();
    // 修炼进度条（10 秒走满）
    const pct = this.tickPct() + "%";
    const tb = $("#tick-bar");
    if (tb) tb.style.width = this.isCultivating() && this.canCultivate() ? pct : "0%";
    const gb = $("#gather-bar"); // 洞府聚灵阵进度条（一直聚灵）
    if (gb) gb.style.width = pct;
    const bb = $("#body-bar"); // 肉身修炼进度条（自动修炼且能修炼时 10 秒走满）
    if (bb) bb.style.width = this.bodyActive() ? pct : "0%";
    const tl = $("#tick-left");  // 本次修炼倒计时
    if (tl) tl.textContent = Math.max(0, Math.ceil(DATA.TICK - (now - this._lastTick) / 1000)) + " 秒";
  },

  // 本次 10 秒周期走了百分之几（进度条用；页面重绘时也直接用这个宽度，避免进度条被重置）
  tickPct() { return Math.min(100, (Date.now() - this._lastTick) / (DATA.TICK * 10)); },

  /* ---------- 操作后统一调用：重算属性、存档、刷新 ---------- */
  after() {
    this.dirty();
    const st = this.stats();
    this.s.hp = Math.min(this.s.hp, st.hp);
    this.s.mana = Math.min(this.s.mana, st.mana);
    this.save();
    this.render();
  },

  /* ---------- 界面 ---------- */
  render() {
    const s = this.s; if (!s || this.silent) return;
    $("#p-name").textContent = s.name;
    $("#p-realm").textContent = this.realmName();
    $("#p-stone").textContent = U.fmt(s.stone);
    $("#p-contrib").textContent = U.fmt(s.contrib || 0);   // v27：贡献、功德
    $("#p-merit").textContent = U.fmt(s.merit || 0);
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === this.tab));
    // 顶部（道号、灵石、贡献、功德）和信息栏只在修炼页显示
    const main = this.tab === "cultivate";
    $("#top").style.display = main ? "" : "none";
    $("#log-wrap").style.display = main ? "" : "none";
    const v = $("#view"), top = v.scrollTop;
    // 某个页面出错时不再整页空白：显示错误信息，其它页面照常可用
    // 内容没变就不重绘：避免每秒重绘时按钮被替换、点了没反应，也省手机电量
    try { const html = this.views[this.tab] ? this.views[this.tab].call(this) : ""; if (html !== this._viewHtml || v.innerHTML === "") { v.innerHTML = html; this._viewHtml = html; } }
    catch (err) { console.error(err); this._viewHtml = null; v.innerHTML = `<div class="card"><h3>页面出错</h3><p class="desc">${String(err && err.message || err)}<br>如果刚改过 js/config/ 里的数值，请检查有没有写错（例如少了小数点、多了问号）。</p></div>`; }
    v.scrollTop = top;
  },
  renderLog() { $("#log").innerHTML = this.s.log.map(l => `<p class="${l.c}">${l.m}</p>`).join(""); },
  // 进度条（叠在“学习中 / 剩余时间”文字下面）：left 剩余毫秒，total 总毫秒；外层元素加 class="pg"
  pgFill(left, total) { const p = total > 0 ? Math.min(100, Math.max(0, (1 - left / total) * 100)) : 0; return `<i class="pgf" style="width:${p.toFixed(1)}%"></i>`; },
  modal(html) { $("#modal-box").innerHTML = html; $("#modal").classList.remove("hidden"); },
  closeModal() { $("#modal").classList.add("hidden"); },

  /* ---------- 启动 ---------- */
  start() {
    this.dirty();
    this._lastTick = this.s.last && this.s.last <= Date.now() ? this.s.last : Date.now();   // v208 接着离线补算后的结算时间
    this.save(true); this.render(); this.renderLog();
    setInterval(() => this.loop(), 200);
    const frame = () => { if (!this._stopped) this.bars(); requestAnimationFrame(frame); };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(frame);
    // 倒计时刷新（只在有倒计时的页面）
    setInterval(() => { if (this.s && this.s.explore && !this._hold) this.advanceExplore(); }, 1000); // 自动探索每秒走一步
    setInterval(() => { if (this.s && this.s.trib) this.advanceTrib(); if (this.tribOpen) this.showTrib(); }, 1000); // 雷劫每秒一回合
    setInterval(() => { if ((this.tab === "gongfa" && this.s.gfStudy) || (this.tab === "sect" && (this.sectTab === "affair" || this.sectTab === "alchemy" || (this.sectTab === "gfroom" && this.freeGfOn()))) || (this.tab === "world" && this.s.explore) || this.tab === "cave" || this.s.gfLearn || this.s.danStudy || this.s.forgeStudy) this.render(); }, 1000);
    // 切到后台 / 关闭页面时立即上传
    document.addEventListener("visibilitychange", () => { if (document.hidden && !this._stopped) { this.save(); API.beacon(this._saveStr); } else if (!document.hidden && !this._stopped) {
      // v245 切回前台：先画一帧（不黑屏），下一轮再补算离开期间的修炼 / 探索并上传
      this._hold = true;
      const go = () => setTimeout(() => { this._hold = false; this.loop(); if (this.s && this.s.explore) this.advanceExplore(); this.save(true); }, 30);
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(go); else go();
      setTimeout(() => { if (this._hold) { this._hold = false; this.loop(); } }, 1500);   // 保险：rAF 没触发也会继续
    } });
    window.addEventListener("pagehide", () => { if (!this._stopped) { this.save(); API.beacon(this._saveStr); } });
  },

  init() {
    const bt = document.getElementById("boot"); if (bt) bt.remove();   // v245 网页加载完：去掉「加载中」
    document.querySelectorAll("#tabs button").forEach(b => {   // 底部导航按钮名字在 config/names.js 的 tab
      const n = DATA.nmPick(CFG.names.tab, b.dataset.tab, ""), t = b.lastChild;
      if (n && t && t.nodeType === 3) t.textContent = n;
    });
    document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => {
      this.tab = b.dataset.tab; $("#view").scrollTop = 0; this.render();
    });
    $("#modal").onclick = e => { if (e.target.id === "modal" && this.s && !this._lockModal) this.closeModal(); };
    this.showLogin(); // 见 modules/account.js
  },
};
