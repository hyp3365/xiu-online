/* =====================================================================
 * 模块：渡劫（突破时的劫云）
 * ---------------------------------------------------------------------
 * 数值全部在 js/config/trib.js。
 * 流程：修为满了点「突破」→ 渡劫准备页（SLOTS 个格子，放法宝 / 法术 / 丹药，丹药每格 1 颗）
 *       → 「开始渡劫」→ 渡劫页（上方劫云，下方人物）
 * 劫云只有攻击，每 HIT_SEC 秒劈一次，人物不还手；撑过 TIME 秒没倒 = 突破成功。
 * 按 G.now() 计时：关掉页面、关掉游戏，劫云照样劈，回来时一次算完。
 * 点「开始突破」先倒计时 PRE_SEC 秒，再开始劈；渡劫中点格子使用法宝 / 法术（得护盾）、丹药（回生命法力），数值见 CFG.trib.USE。
 *
 * 存档：
 *   s.tribSlots  [格子]：{ k: "fb", uid } 法宝 / { k: "sp", id } 法术 / { k: "it", name } 丹药；空格 null
 *   s.trib       正在进行（或刚结束还没关）的渡劫：
 *                { v: 2, L 突破后层序, start 劫雷开始时间（= 点开始 + PRE_SEC 秒）, time 时长秒, sec 已过秒, atk, crit, taken 共承受, hits 被劈次数, log, result,
 *                  shield 护盾 { hp, def, red } | null, cd { 格子序号: 可再用的时间 }, used { 格子序号: true 丹药已用 } }
 * ===================================================================== */
G.module({
  id: "trib",

  defaults: () => ({
    tribSlots: [],
  }),

  api: {
    /* ---------- 数值 ---------- */
    // 渡劫时长（秒）：按突破后的大境界查 TIME（键 = 境界原名或改名后的名字）
    tribTime(L) {
      const T = CFG.trib, ri = Math.floor(L / DATA.LAYERS), o = T.TIME || {};
      const v = o[DATA.realms[ri]] !== undefined ? o[DATA.realms[ri]] : o[DATA.NM_DEF.realm[ri]];
      return Math.max(1, v !== undefined ? v : T.TIME_DEFAULT || 60);
    },
    // 劫云（v226）：属性 = 突破后那一层（境界、层）的修为 + 肉身 + 三类功法（学% 按层平均递增）× 当层倍率 × 随机 CFG.trib.RAND
    tribRow(L) {
      const T = CFG.trib, ri = Math.floor(L / DATA.LAYERS), lay = L % DATA.LAYERS + 1;
      const rows = Array.isArray(T.MOB) ? T.MOB : [];
      const R = DATA.mobRange, hit = r => Array.isArray(r) && r[0] === ri && lay >= R(r[1])[0] && lay <= R(r[1])[1];
      let r = rows.find(hit);
      if (!r) { const d = T.MOB_DEFAULT || [0, [1, 10], [1, 100, 4], [2, 0, 0], [3, 0, 0], 0]; r = [ri].concat(d.slice(1)); }
      const ly = R(r[1]), p = ly[1] > ly[0] ? (lay - ly[0]) / (ly[1] - ly[0]) : 0;   // 这一层在分段里的位置 0 ~ 1
      const lerp = (v, round) => { const a = R(v), x = a[0] + (a[1] - a[0]) * p; return round ? Math.round(x) : x; };
      const cat = c => { const x = r.slice(2, 5).find(y => Array.isArray(y) && y[0] === c) || [c, 0, 0]; return [c, lerp(x[1]), lerp(x[2], true)]; };
      const k = 1 + (lay - ly[0]) * (r[5] || 0);
      return [0, ri, lay, 0, cat(1), cat(2), cat(3), k];   // 怪物 8 个数格式，功法星级 0 = 该境界能学到的全部星级
    },
    makeTrib(L) {
      const T = CFG.trib, st = DATA.mobStats(this.tribRow(L));
      const R = T.RAND || [1, 1], rnd = R[0] + Math.random() * (R[1] - R[0]);
      return { atk: st.atk * rnd, crit: T.crit === undefined ? 5 : T.crit };
    },
    // 劫云劈一次的伤害 [伤害, 是否暴击]
    tribHit(x) {
      const BT = CFG.battle, def = this.stats().def;
      let d = Math.max(DATA.minDmg(this.s.mortal ? 0 : this.s.L), x.atk - def * BT.DEF_RATE) * (BT.RAND_MIN + Math.random() * (BT.RAND_MAX - BT.RAND_MIN));
      const c = Math.random() * 100 < Math.min(DATA.CRIT_CAP || 100, x.crit);
      return [c ? d * BT.CRIT_MULT : d, c];
    },

    /* ---------- 准备页的格子 ---------- */
    tribSlotN() { return CFG.trib.SLOTS || 10; },
    // 找格子里的东西；找不到（卖了、用了、遗忘了）返回 null
    tribFind(c) {
      const s = this.s; if (!c) return null;
      if (c.k === "fb") {
        const e = (s.fabao || []).find(e => e && e.uid === c.uid) || ((s.bag.find(it => it.t === "eq" && it.e.uid === c.uid) || {}).e);
        return e ? { name: this.itemName({ t: "eq", e }), img: DATA.eqIcon(e), tag: "法宝" } : null;
      }
      if (c.k === "sp") { const g = s.gongfa[c.id] && DATA.spellInfo(c.id, s.gongfa[c.id]); return g ? { name: `《${g.name}》`, img: "", tag: "法术" } : null; }
      if (c.k === "it") {
        const it = s.bag.find(it => (it.t === "pill" || it.t === "dan") && this.itemName(it) === c.name);
        return it ? { name: c.name, img: this.itemIcon(it), tag: "丹药" } : null;
      }
      return null;
    },
    // 同一颗丹药在格子里放了几颗（每格 1 颗，背包数量不够就放不进）
    tribPillUsed(name) { return this.s.tribSlots.filter(c => c && c.k === "it" && c.name === name).length; },
    tribPick(i) {
      const s = this.s, used = c => s.tribSlots.some(x => x && x.k === c.k && (x.uid || x.id) === (c.uid || c.id));
      const row = (img, name, tag, call) => `<div class="line"><div>${img ? DATA.li(img) : ""}${name}<small>${tag}</small></div><button class="sm" onclick="${call}">放入</button></div>`;
      let h = "";
      const fbs = [...(s.fabao || []).filter(Boolean), ...s.bag.filter(it => it.t === "eq" && it.e.slot === "fabao").map(it => it.e)];
      fbs.forEach(e => { if (!e.uid) e.uid = "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); });
      const fb = fbs.filter(e => !used({ k: "fb", uid: e.uid }));
      const sp = Object.keys(s.gongfa).filter(id => DATA.isSpell(id) && !used({ k: "sp", id }));
      const names = [...new Set(s.bag.filter(it => it.t === "pill" || it.t === "dan").map(it => this.itemName(it)))];
      const pills = names.map(n => ({ n, it: s.bag.find(it => (it.t === "pill" || it.t === "dan") && this.itemName(it) === n) }))
        .filter(p => (this.bagCount()[p.n] || 0) > this.tribPillUsed(p.n));
      if (fb.length) h += `<p class="desc">法宝</p>` + fb.map(e => row(DATA.eqIcon(e), this.itemName({ t: "eq", e }), "法宝", `G.tribPut(${i},'fb','${e.uid}')`)).join("");
      if (sp.length) h += `<p class="desc">法术</p>` + sp.map(id => { const g = DATA.spellInfo(id, s.gongfa[id]); return row("", `《${g.name}》`, `${g.star}星`, `G.tribPut(${i},'sp','${id}')`); }).join("");
      if (pills.length) h += `<p class="desc">丹药（每格 1 颗）</p>` + pills.map(p => row(this.itemIcon(p.it), p.n, `剩 ${U.fmt((this.bagCount()[p.n] || 0) - this.tribPillUsed(p.n))} 颗可放`, `G.tribPut(${i},'it','${p.n}')`)).join("");
      this.modal(`<h2>第 ${i + 1} 格</h2>${h || `<p class="desc">没有可放入的法宝、法术、丹药。</p>`}
        <div class="btns">${s.tribSlots[i] ? `<button onclick="G.tribPut(${i})">清空这格</button>` : ""}<button onclick="G.closeModal()">关闭</button></div>`);
    },
    tribPut(i, k, v) {
      const sl = this.s.tribSlots;
      while (sl.length < this.tribSlotN()) sl.push(null);
      sl[i] = !k ? null : k === "fb" ? { k, uid: v } : k === "sp" ? { k, id: v } : { k, name: v };
      this.closeModal(); this.tribRender(true); this.save && this.save();
    },

    /* ---------- 进入 / 开始 / 结束 ---------- */
    // 「突破」按钮：有渡劫在进行就看渡劫页，没有就进准备页
    openTrib() { this.tribOpen = true; this.tribRender(true); },
    closeTrib() {
      this.tribOpen = false; $("#trib").classList.add("hidden"); $("#trib").innerHTML = "";
      if (this.s.trib && this.s.trib.result) this.s.trib = null;   // 结束后离开才清除记录
      this.render();
    },
    startTrib() {
      const s = this.s; if (s.trib || !this.canBreak() || !this.needTrib()) return;
      const L = s.L + 1, t = this.makeTrib(L), st = this.stats();
      s.hp = st.hp; s.mana = st.mana;   // 开始时生命法力回满
      s.trib = { v: 2, L, start: this.now() + (CFG.trib.PRE_SEC || 0) * 1000, time: this.tribTime(L), sec: 0, atk: t.atk, crit: t.crit, taken: 0, hits: 0, log: [], result: "", shield: null, cd: {}, used: {} };
      this.log(`劫云压顶，${this.realmName(L)}天劫降临！`, "gold");
      this.tribOpen = true; this.save && this.save(); this.tribRender(true);
    },
    // 按时间推进：每 HIT_SEC 秒劈一次（离线回来一次算完）
    advanceTrib() {
      const s = this.s, x = s.trib; if (!x || x.result) return;
      const HS = CFG.trib.HIT_SEC || 1;
      let hit = null;
      while (!x.result) {
        const nextHit = (Math.floor(x.sec / HS) + 1) * HS;
        if (nextHit > x.time) { if (this.now() >= x.start + x.time * 1000) { x.sec = x.time; this.endTrib(true); } break; }
        if (this.now() < x.start + nextHit * 1000) break;
        x.sec = nextHit;
        let [d, c] = this.tribHit(x), ab = 0, brk = false;
        const sh = x.shield;
        if (sh && sh.hp > 0) {   // 护盾：先减盾防御，再减「受到伤害减少%」，剩下先扣护盾值
          const BT = CFG.battle;
          d = Math.max(0, d - (sh.def || 0) * BT.DEF_RATE) * (1 - (sh.red || 0) / 100);
          ab = Math.min(sh.hp, d); sh.hp -= ab; d -= ab;
          if (sh.hp <= 0) { x.shield = null; brk = true; }
        }
        s.hp -= d; x.taken += d; x.hits++;
        hit = { d, c, ab };
        x.log.unshift(`第${x.sec}秒：劫雷劈中你 ${U.fmt(d)}${c ? "（暴击）" : ""}${ab ? `（护盾抵挡 ${U.fmt(ab)}）` : ""}${brk ? "，护盾破碎" : ""}`);
        if (x.log.length > 60) x.log.length = 60;
        if (s.hp <= 0) this.endTrib(false);
        else if (x.sec >= x.time) this.endTrib(true);
      }
      if (hit) this._tribHit = hit;
    },
    endTrib(win) {
      const s = this.s, x = s.trib;
      if (win) {
        s.exp -= this.needExp(); s.L = x.L; this.dirty();
        const st = this.stats(); s.hp = st.hp; s.mana = st.mana;
        x.result = `渡劫成功！踏入【${this.realmName()}】。`;
        this.log(x.result, "gold");
      } else {
        s.hp = 1;
        const loss = Math.floor(s.exp * CFG.trib.FAIL_LOSS); s.exp -= loss;
        x.result = `渡劫失败：被劫雷劈倒，修为 -${U.fmt(loss)}。`;
        this.log(x.result, "bad");
      }
      this.dirty(); if (!this.silent) { this.save(); this.render(); }
    },

    /* ---------- 画面 ---------- */
    // 每秒调用：full = 整页重画，否则只更新数字、血条、闪电
    showTrib() { if (this.tribOpen) this.tribRender(false); },
    tribRender(full) {
      const el = $("#trib"); if (!this.tribOpen || !el) return;
      el.classList.remove("hidden");
      const x = this.s.trib;
      if (!x) { if (full || el.dataset.mode !== "prep") { el.dataset.mode = "prep"; el.innerHTML = this.tribPrepHtml(); } return; }
      const mode = x.result ? "end" : "run";
      // 最后一击（劈死或撑到最后一秒）：先在渡劫画面把这道雷劈出来、扣血，约 1 秒后再显示结果
      if (!full && mode === "end" && el.dataset.mode === "run") {
        if (this._tribHit) { this._tribHold = Date.now() + 1000; setTimeout(() => this.tribRender(false), 1050); }
        if (this._tribHold && Date.now() < this._tribHold) { this.tribUpd(); return; }
      }
      this._tribHold = 0;
      if (full || el.dataset.mode !== mode) { el.dataset.mode = mode; el.innerHTML = this.tribRunHtml(); this._tribHit = null; return; }
      this.tribUpd();
    },
    // 渡劫画面：只更新会变的数字、血条、日志，有新的一击就画闪电
    tribUpd() {
      const x = this.s.trib; if (!x) return;
      const s = this.s, st = this.stats(), dead = x.result && !/成功/.test(x.result);
      const hp = dead ? 0 : Math.max(0, s.hp), hpPct = hp / st.hp * 100;   // 被劈倒：结算后生命留 1，画面上先显示 0
      const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
      set("tj-left", x.time - x.sec); set("tj-hp", `${U.fmt(hp)} / ${U.fmt(st.hp)}`); set("tj-taken", U.fmt(x.taken));
      const bar = document.getElementById("tj-hpbar"); if (bar) bar.style.width = hpPct + "%";
      set("tj-mp", `${U.fmt(Math.max(0, s.mana || 0))} / ${U.fmt(st.mana || 0)}`);
      const mb = document.getElementById("tj-mpbar"); if (mb) mb.style.width = (st.mana ? Math.max(0, s.mana || 0) / st.mana * 100 : 0) + "%";
      const tb = document.getElementById("tj-timebar"); if (tb) tb.style.width = x.sec / x.time * 100 + "%";
      const lg = document.getElementById("tj-log"); if (lg) lg.innerHTML = x.log.slice(0, 8).map(l => `<p>${l}</p>`).join("");
      const shv = x.shield && x.shield.hp > 0 ? x.shield.hp : 0;
      set("tj-sh", U.fmt(shv));
      const ring = document.getElementById("tj-shield"); if (ring) ring.classList.toggle("on", shv > 0 && !x.result);
      const pre = Math.ceil((x.start - this.now()) / 1000), cd = document.getElementById("tj-cd");
      if (cd) { cd.textContent = pre > 0 && !x.result ? pre : ""; cd.classList.toggle("on", pre > 0 && !x.result); }
      const sl = document.getElementById("tj-run-slots"); if (sl) sl.innerHTML = this.tribRunSlots();
      if (this._tribHit) { this.tribBolt(this._tribHit); this._tribHit = null; }
    },
    // 一道劫雷：分形折线（中点位移）从云眼劈到人物头顶，带多级分叉；外层紫色辉光 + 中层淡紫 + 白色雷芯，劈下后再闪一次
    tribBolt(h) {
      const st = document.getElementById("tj-stage"), hero = document.getElementById("tj-hero"); if (!st || !hero) return;
      const W = st.clientWidth || 360, H = st.clientHeight || 380, R = Math.random;
      // 中点位移：两点之间反复取中点并横向偏移，偏移量逐级减半，得到自然的锯齿雷线
      const frac = (a, b, dis, depth) => {
        if (depth <= 0) return [a, b];
        const mx = (a[0] + b[0]) / 2 + (R() - 0.5) * dis, my = (a[1] + b[1]) / 2 + (R() - 0.5) * dis * 0.3;
        const l = frac(a, [mx, my], dis / 2, depth - 1), r = frac([mx, my], b, dis / 2, depth - 1);
        return l.concat(r.slice(1));
      };
      const make = () => {
        const top = [W * (0.5 + (R() - 0.5) * 0.12), H * 0.16], end = [W * 0.5 + (R() - 0.5) * 8, H * 0.7];
        const main = frac(top, end, W * 0.22, 6), out = [{ p: main, lv: 0 }];
        const branch = (src, lv) => {
          const n = lv ? 1 : 2 + Math.floor(R() * 3);
          for (let i = 0; i < n; i++) {
            const s = src[Math.floor(src.length * (0.1 + R() * 0.6))], dir = R() < 0.5 ? -1 : 1, len = H * (lv ? 0.07 : 0.12 + R() * 0.12);
            const e = [s[0] + dir * len * (0.5 + R() * 0.7), s[1] + len * (0.6 + R() * 0.5)];
            const p = frac(s, e, len * 0.5, 4); out.push({ p, lv: lv + 1 });
            if (lv < 1 && R() < 0.6) branch(p, lv + 1);
          }
        };
        branch(main, 0); return out;
      };
      const pts = p => p.map(q => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ");
      const draw = ls => ls.map(({ p, lv }) => {
        const k = lv === 0 ? (h.c ? 1.4 : 1) : lv === 1 ? 0.45 : 0.25, P = pts(p);
        return `<polyline class="g" points="${P}" style="stroke-width:${14 * k}"/><polyline class="m" points="${P}" style="stroke-width:${5 * k}"/><polyline class="c" pathLength="1" points="${P}" style="stroke-width:${Math.max(0.8, 2.2 * k)}"/>`;
      }).join("");
      const id = "tjb" + Date.now() % 100000;
      const svg = ls => `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs><g filter="url(#${id})">${ls.map(({ p, lv }) => `<polyline class="g" points="${pts(p)}" style="stroke-width:${lv ? 6 : 18}"/>`).join("")}</g>${draw(ls)}</svg>`;
      const b = document.createElement("div"); b.className = "tj-bolt" + (h.c ? " crit" : "");
      const ls = make(); b.innerHTML = svg(ls) + `<div class="tj-hitglow"></div>`;
      st.appendChild(b);
      // 回闪：同一主干稍微抖动后再亮一次
      setTimeout(() => { if (b.isConnected) { const s2 = b.querySelector("svg"); if (s2) s2.outerHTML = svg(ls.map(o => ({ lv: o.lv, p: o.p.map(q => [q[0] + (R() - 0.5) * 3, q[1]]) }))); } }, 140);
      setTimeout(() => b.remove(), 650);
      st.classList.remove("tj-flash"); void st.offsetWidth; st.classList.add("tj-flash");
      hero.classList.remove("tj-shake"); void hero.offsetWidth; hero.classList.add("tj-shake");
      const ring = document.getElementById("tj-shield"); if (ring && h.ab) { ring.classList.remove("hit"); void ring.offsetWidth; ring.classList.add("hit"); }
      const n = document.createElement("div"); n.className = "tj-dmg" + (h.c ? " crit" : ""); n.textContent = "-" + U.fmt(h.d) + (h.c ? " 暴击" : "");
      n.style.left = 52 + Math.random() * 20 + "%"; st.appendChild(n); setTimeout(() => n.remove(), 1200);
    },
    // 舞台：上方劫云（img/trib_cloud.webp），下方打坐人物（img/trib_hero.webp），中间放倒计时
    tribStageHtml(mid, cls) {
      const v = DATA.IMG_V || 1, cl = `url(img/trib_cloud.webp?v=${v})`;
      return `<div class="tj-stage ${cls || ""}" id="tj-stage">
        <div class="tj-sky" style="background-image:${cl}"></div>
        <div class="tj-fog" style="background-image:${cl}"></div>
        <div class="tj-vortex" style="background-image:${cl}"></div>
        <div class="tj-amb"></div>
        <div class="tj-mid">${mid || ""}</div>
        <div class="tj-cd" id="tj-cd"></div>
        <div class="tj-hero" id="tj-hero"><div class="tj-aura"></div><img src="img/trib_hero.webp?v=${v}" alt=""><div class="tj-shield" id="tj-shield"></div></div>
      </div>`;
    },
    tribPrepHtml() {
      const s = this.s, N = this.tribSlotN(), L = s.L + 1, t = this.makeTrib(L), st = this.stats(), T = this.tribTime(L);
      const ok = this.canBreak() && this.needTrib();
      const cells = Array.from({ length: N }, (_, i) => {
        const c = s.tribSlots[i], f = this.tribFind(c);
        return `<div class="tj-slot${f ? " on" : c ? " lost" : ""}" onclick="G.tribPick(${i})">${f ? `${f.img ? `<img src="${f.img}" alt="">` : `<span class="tj-ic">${f.tag.slice(0, 1)}</span>`}<small>${f.name}</small>` : c ? "<small>已失效</small>" : "<span class='tj-plus'>＋</span>"}</div>`;
      }).join("");
      return `<div class="tj-wrap tj-prep">
        <div class="tj-prep-title">突破准备</div>
        <div class="tj-slots">${cells}</div>
        <div class="btns"><button onclick="G.closeTrib()">放弃突破</button><button class="primary" onclick="G.startTrib()" ${ok ? "" : "disabled"}>开始突破</button></div>
      </div>`;
    },
    tribRunHtml() {
      const s = this.s, x = s.trib, st = this.stats(), end = !!x.result, win = end && /成功/.test(x.result);
      const cells = this.tribRunSlots();
      return `<div class="tj-wrap${end ? win ? " win" : " lose" : ""}">
        <div class="tj-head"><button class="sm" onclick="G.closeTrib()">${end ? "离开" : "返回（渡劫继续）"}</button><b>渡劫 · ${this.realmName(x.L)}</b><span></span></div>
        ${this.tribStageHtml("", end ? win ? "win" : "dead" : "")}
        <div class="bar tick"><div id="tj-timebar" style="width:${x.sec / x.time * 100}%"></div></div>
        <div class="row small"><span>生命 <b id="tj-hp">${U.fmt(Math.max(0, s.hp))} / ${U.fmt(st.hp)}</b></span><span>共承受 <b id="tj-taken">${U.fmt(x.taken)}</b></span></div>
        <div class="bar hp"><div id="tj-hpbar" style="width:${Math.max(0, s.hp) / st.hp * 100}%"></div></div>
        <div class="row small"><span>法力 <b id="tj-mp">${U.fmt(Math.max(0, s.mana || 0))} / ${U.fmt(st.mana || 0)}</b></span><span>护盾 <b id="tj-sh">${U.fmt(x.shield && x.shield.hp > 0 ? x.shield.hp : 0)}</b></span></div>
        <div class="bar mp"><div id="tj-mpbar" style="width:${st.mana ? Math.max(0, s.mana || 0) / st.mana * 100 : 0}%"></div></div>
        ${end ? `<p class="${win ? "q4" : "q5"}" style="text-align:center"><b>${x.result}</b></p>` : ""}
        ${cells && !end ? `<div class="tj-slots run" id="tj-run-slots">${cells}</div>` : ""}
        <div class="trib-log" id="tj-log">${x.log.slice(0, 8).map(l => `<p>${l}</p>`).join("") || "<p>乌云压顶，雷光翻涌……</p>"}</div>
        ${end ? `<div class="btns"><button class="primary" style="flex-basis:100%" onclick="G.closeTrib()">离开</button></div>` : ""}
      </div>`;
    },
    // 渡劫页的格子：显示冷却秒数、丹药已用
    tribRunSlots() {
      const x = this.s.trib; if (!x) return "";
      return (this.s.tribSlots || []).map((c, i) => {
        const f = this.tribFind(c); if (!f) return "";
        const used = x.used && x.used[i], left = Math.ceil(((x.cd || {})[i] - this.now()) / 1000);
        return `<div class="tj-slot on sm${used || left > 0 ? " cd" : ""}" onclick="G.tribUse(${i})">${f.img ? `<img src="${f.img}" alt="">` : `<span class="tj-ic">${f.tag.slice(0, 1)}</span>`}<small>${f.name}</small>${used ? `<b class="tj-cdn">已用</b>` : left > 0 ? `<b class="tj-cdn">${left}</b>` : ""}</div>`;
      }).join("");
    },
    tribToast(msg) {
      const n = $("#toast"); if (!n) return;
      n.innerHTML = `<p class="sys">${msg}</p>`; n.classList.add("show");
      clearTimeout(this._toastT); this._toastT = setTimeout(() => n.classList.remove("show"), 2000);
    },
    // 渡劫中点格子 i：法宝 / 法术 → 护盾，丹药 → 回生命法力
    tribUse(i) {
      const s = this.s, x = s.trib; if (!x || x.result) return;
      this.advanceTrib(); if (x.result) return this.tribRender(false);
      const c = s.tribSlots[i], f = this.tribFind(c), U0 = CFG.trib.USE || {}; if (!f) return;
      if (!x.cd) x.cd = {}; if (!x.used) x.used = {};
      if (x.used[i]) return this.tribToast("这颗丹药已经用了");
      if ((x.cd[i] || 0) > this.now()) return this.tribToast(`还要 ${Math.ceil((x.cd[i] - this.now()) / 1000)} 秒才能再用`);
      const st = this.stats(), addSh = o => {
        const sh = x.shield && x.shield.hp > 0 ? x.shield : { hp: 0, def: 0, red: 0 };
        sh.hp += o.hp;
        sh.def = Math.max(sh.def, o.def || 0); sh.red = Math.max(sh.red, o.red || 0); x.shield = sh;
      };
      let msg;
      if (c.k === "fb") {
        const e = (s.fabao || []).find(e => e && e.uid === c.uid) || ((s.bag.find(it => it.t === "eq" && it.e.uid === c.uid) || {}).e);
        if (!e || !e.attrs) return this.tribToast("这件法宝无法祭出");
        const fb = DATA.fabaoInfo(e);
        if ((s.mana || 0) < fb.mana) return this.tribToast("法力不足");
        s.mana -= fb.mana;
        const o = fb.shield ? { hp: fb.shield.hp, def: fb.shield.def, red: fb.shield.red }
          : { hp: (Math.max(0, fb.atk * fb.pct / 100) + (fb.addDmg || 0)) * (U0.FB_SHIELD === undefined ? 1 : U0.FB_SHIELD) };
        addSh(o); x.cd[i] = this.now() + (U0.FB_CD || 0) * 1000;
        msg = `祭出${fb.name}，护盾 +${U.fmt(o.hp)}`;
      } else if (c.k === "sp") {
        const sp = DATA.spellInfo(c.id, s.gongfa[c.id]);
        if ((s.mana || 0) < sp.mana) return this.tribToast("法力不足");
        s.mana -= sp.mana;
        const hp = Math.max(0, sp.atk * sp.pct / 100 * sp.mul * this.lingenSpell(sp.el.id)) * (U0.SP_SHIELD === undefined ? 1 : U0.SP_SHIELD);
        addSh({ hp }); x.cd[i] = this.now() + (U0.SP_CD || 0) * 1000;
        msg = `施展《${sp.name}》，护盾 +${U.fmt(hp)}`;
      } else if (c.k === "it") {
        const bi = s.bag.findIndex(it => (it.t === "pill" || it.t === "dan") && this.itemName(it) === c.name); if (bi < 0) return;
        const it = s.bag[bi];
        if (it.t === "dan" && this.danLeft(it.type, it.g) > 0) { const key = it.type + "|" + it.g; s.danEaten[key] = (s.danEaten[key] || 0) + 1; this.dirty(); }
        this.removeAt(bi, 1);
        const st2 = this.stats(), hp = st2.hp * (U0.PILL_HP || 0) / 100, mp = (st2.mana || 0) * (U0.PILL_MP || 0) / 100;
        s.hp = Math.min(st2.hp, s.hp + hp); s.mana = Math.min(st2.mana || 0, (s.mana || 0) + mp);
        x.used[i] = true;
        msg = `服下${c.name}，生命 +${U.fmt(hp)}、法力 +${U.fmt(mp)}`;
      }
      if (msg) { x.log.unshift(msg); if (x.log.length > 60) x.log.length = 60; }
      this.save && this.save(); this.tribUpd();
    },
  },
});
