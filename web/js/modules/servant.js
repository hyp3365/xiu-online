/* =====================================================================
 * 模块：洞府 · 道童居（数值在 config/servant.js）
 * 存档：
 *   servants   [{ uid, star 资质, el 五行, lv 等级, job 差事 id 或 null, av 头像, paid 俸禄发到哪天(北京日期) }]
 *   svPick     选拔中 { end } | 选拔完成待处理 { star, el, av } | null
 *   svAuto     自动发放俸禄
 * ===================================================================== */
G.module({
  id: "servant",
  defaults: () => ({ servants: [], svPick: null, svAuto: false }),
  tick() {
    const s = this.s, C = CFG.servant, p = s.svPick;
    if (p && p.end && this.now() >= p.end) {
      const av = Math.floor(Math.random() * C.AVATARS);
      s.svPick = { star: U.weighted(C.STAR_W) + 1, el: U.pick(Object.keys(C.EL)), av, name: this.svRandName(av) };
      this.log(`道童选拔结束：选出${this.svName(s.svPick)}。`, "good"); this.dirty();
    }
    if (s.svAuto) s.servants.forEach(d => { const c = this.svOwed(d) * this.svSalary(d); if (c > 0 && s.stone >= c) { s.stone -= c; d.paid = this.bjDay(); this.dirty(); } });
    const gone = s.servants.filter(d => this.svOwed(d) > C.SALARY.LEAVE_DAYS);
    if (gone.length) { s.servants = s.servants.filter(d => !gone.includes(d)); gone.forEach(d => this.log(`${this.svName(d)}连续多日未领俸禄，离开了洞府。`, "bad")); this.dirty(); }
  },
  api: {
    svName(d) { return d.name || `${CFG.servant.EL[d.el] || d.el}·${d.star}星道童`; },
    svRandName(av) { const C = CFG.servant; return U.pick(C.SURNAME) + U.pick((C.AV_FEMALE || []).includes(av) ? C.NAME_F : C.NAME_M); },
    svImg(d) { return `img/sv${(d.av || 0) % CFG.servant.AVATARS}.png?v=2`; },
    // 1 级 a、满级 b，中间每级 × 同一个倍率
    svGeo(a, b, lv) { const M = CFG.servant.MAX_LV; return M <= 1 ? b : a * Math.pow(b / a, (Math.min(lv, M) - 1) / (M - 1)); },
    // 升级倍率：1 级升 2 级 UP_BASE，升满总量 = UP_TOTAL + (10 − 星) × UP_STAR_ADD
    svUpRate(star) {
      const C = CFG.servant, key = [C.UP_BASE, C.UP_TOTAL, C.UP_STAR_ADD, C.MAX_LV, star].join(",");
      if (!this._svRate) this._svRate = {};
      if (this._svRate[key]) return this._svRate[key];
      const n = C.MAX_LV - 1, tot = C.UP_TOTAL + (10 - star) * C.UP_STAR_ADD, sum = r => Math.abs(r - 1) < 1e-12 ? C.UP_BASE * n : C.UP_BASE * (Math.pow(r, n) - 1) / (r - 1);
      let lo = 0.0001, hi = 10; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (sum(m) < tot) lo = m; else hi = m; }
      return (this._svRate[key] = (lo + hi) / 2);
    },
    svUpCost(d) { const C = CFG.servant; return Math.round(C.UP_BASE * Math.pow(this.svUpRate(d.star), d.lv - 1)); },
    svSalary(d) { const S = CFG.servant.SALARY; return Math.round(this.svGeo(S.LV1, S.MAX, d.lv)); },   // 只看等级，不看资质
    svOwed(d) { return Math.max(0, Math.round((Date.parse(this.bjDay()) - Date.parse(d.paid || this.bjDay())) / 864e5)); },
    // 某差事的效果 %（所有派去的道童相加）
    // 效果曲线：x = (等级−1)/(满级−1)，占比 = x^p；p 让第 50 级正好占 HALF_PCT %
    svCurve(lv) {
      const C = CFG.servant, M = C.MAX_LV; if (M <= 1) return 1;
      const h = Math.min(99, Math.max(1, C.HALF_PCT || 50)) / 100, xh = (Math.min(50, M) - 1) / (M - 1);
      const p = xh > 0 && xh < 1 ? Math.log(h) / Math.log(xh) : 1;
      return Math.pow((Math.min(lv, M) - 1) / (M - 1), p);
    },
    svEff(d, job) {
      const C = CFG.servant, J = C.JOB[job]; if (!J) return 0;
      const a = J.LV1 || 0;
      return Math.round((a + (J.MAX - a) * this.svCurve(d.lv)) * 100) / 100;   // 每级都提升（保留 2 位小数）
    },
    svEffTxt(job, v) { return job === "zhen" ? `聚灵 +${U.num(v)}%` : `${job === "cult" ? "+" : "−"}${U.num(v)}%`; },
    servantPct(job) { return (this.s.servants || []).filter(d => d.job === job).reduce((t, d) => t + this.svEff(d, job), 0); },
    svStartPick() {
      const s = this.s, C = CFG.servant, p = s.svPick;
      if (p && !p.end) return this.svOpenPick();
      if (p) return;
      if (s.servants.length >= C.MAX) return this.log("道童已满。", "sys");
      if (s.stone < C.PICK_COST) return this.log("灵石不足。", "sys");
      s.stone -= C.PICK_COST; s.svPick = { end: this.now() + C.PICK_SEC * 1000 };
      this.log("开始选拔道童。", "good"); this.after();
    },
    svOpenPick() {
      const p = this.s.svPick, full = this.s.servants.length >= CFG.servant.MAX;
      this.modal(`<h2>选拔结果</h2><div class="sv-pick"><img src="${this.svImg(p)}" alt=""><div><b>${this.svName(p)}</b><br>资质 ${p.star} 星 · 五行 ${CFG.servant.EL[p.el]}</div></div>
        <div class="btns"><button class="primary" onclick="G.svAccept(true)" ${full ? "disabled" : ""}>${full ? "道童已满" : "收下"}</button><button onclick="G.svAccept(false)">遣散</button></div>`);
    },
    svAccept(keep) {
      const s = this.s, p = s.svPick; if (!p || p.end) return;
      if (keep) {
        if (s.servants.length >= CFG.servant.MAX) return this.log("道童已满。", "sys");
        s.servants.push({ uid: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), star: p.star, el: p.el, av: p.av || 0, name: p.name || this.svRandName(p.av || 0), lv: 1, job: null, paid: this.bjDay() });
        this.log(`收下${this.svName(p)}。`, "good");
      }
      s.svPick = null; this.closeModal(); this.after();
    },
    svPay(i) {
      const s = this.s, d = s.servants[i]; if (!d) return;
      const c = this.svOwed(d) * this.svSalary(d); if (!c) return;
      if (s.stone < c) return this.log("灵石不足。", "sys");
      s.stone -= c; d.paid = this.bjDay();
      this.log(`给${this.svName(d)}发放俸禄 ${U.fmt(c)} 灵石。`, "good"); this.after(); this.openSv(i);
    },
    svAutoToggle(i) { this.s.svAuto = !this.s.svAuto; this.tickAll(false); this.after(); if (i != null) this.openSv(i); },
    svUp(i) {
      const s = this.s, d = s.servants[i]; if (!d || d.lv >= CFG.servant.MAX_LV) return;
      const c = this.svUpCost(d); if (s.stone < c) return this.log("灵石不足。", "sys");
      s.stone -= c; d.lv++; this.after(); this.openSv(i);
    },
    svFire(i) {
      if (!confirm("遣散这个道童？")) return;
      this.s.servants.splice(i, 1); this.closeModal(); this.after();
    },
    openSv(i) {
      const d = this.s.servants[i]; if (!d) return this.closeModal();
      const C = CFG.servant, max = d.lv >= C.MAX_LV, c = this.svUpCost(d), J = C.JOB[d.job], ow = this.svOwed(d), owc = ow * this.svSalary(d), au = this.s.svAuto;
      this.modal(`<h2>${this.svName(d)}</h2><div class="sv-pick"><img src="${this.svImg(d)}" alt=""><div>
        资质 ${d.star} 星 · 五行 ${C.EL[d.el]}<br>等级 ${d.lv} / ${C.MAX_LV}<br>差事：${J ? `${J.name} ${this.svEffTxt(d.job, this.svEff(d, d.job))}` : "空闲"}<br>每日俸禄 ${U.fmt(this.svSalary(d))} 灵石${ow ? `<br><span class="q5">欠发 ${ow} 天</span>` : ""}</div></div>
        <div class="btns"><button class="${au ? "on" : ""}" onclick="G.svAutoToggle(${i})">自动发放俸禄：${au ? "开" : "关"}</button><button onclick="G.svPay(${i})" ${owc && this.s.stone >= owc ? "" : "disabled"}>发放俸禄${owc ? `（${U.fmt(owc)} 灵石）` : ""}</button></div>
        <div class="btns"><button class="primary" onclick="G.svUp(${i})" ${max || this.s.stone < c ? "disabled" : ""}>${max ? "已满级" : `升级（${U.fmt(c)} 灵石）`}</button>
        <button onclick="G.svFire(${i})">遣散</button><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 差事：点开后选道童，每种五行一个位置
    svOpenJob(job) {
      const C = CFG.servant, J = C.JOB[job], L = this.s.servants;
      const slots = J.els.map(el => { const i = L.findIndex(d => d.job === job && d.el === el);
        return `<div class="line"><div>${C.EL[el]}${i >= 0 ? `：${this.svName(L[i])} ${L[i].lv}级` : "：空"}</div>${i >= 0 ? `<button class="sm" onclick="G.svSetJob(${i},null,'${job}')">撤回</button>` : ""}</div>`; }).join("");
      const cand = L.map((d, i) => [d, i]).filter(([d]) => J.els.includes(d.el) && d.job !== job);
      this.modal(`<h2>${J.name}<small> ${this.svEffTxt(job, this.servantPct(job))}</small></h2>${slots}
        <h3 style="margin-top:8px">选择道童</h3>
        ${cand.length ? cand.map(([d, i]) => `<div class="line"><div class="sv-li"><img src="${this.svImg(d)}" alt="">${this.svName(d)} · ${C.EL[d.el]} · ${d.lv}级${d.job ? `<small>${C.JOB[d.job].name}中</small>` : ""}</div><button class="sm primary" onclick="G.svSetJob(${i},'${job}','${job}')">派遣</button></div>`).join("") : `<p>没有可派遣的${J.els.map(e => C.EL[e]).join("、")}属性道童。</p>`}
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    svSetJob(i, job, back) {
      const L = this.s.servants, d = L[i]; if (!d) return;
      if (job) L.forEach(x => { if (x.job === job && x.el === d.el) x.job = null; });
      d.job = job; this.after(); this.svOpenJob(back);
    },
  },
});

/* 洞府 · 道童居 */
G.caveViews.servant = function () {
  const s = this.s, C = CFG.servant, p = s.svPick, n = s.servants.length;
  const rows = s.servants.map((d, i) => { const o = this.svOwed(d);
    return `<div class="sv-row"><img src="${this.svImg(d)}" alt=""><div class="sv-nm">${this.svName(d)}<small>${d.job ? C.JOB[d.job].name : "空闲"}${o ? ` · <span class="q5">欠俸 ${o} 天</span>` : ""}</small></div><b class="sv-el sv-${d.el}">${C.EL[d.el]}</b><span>资质${d.star}星</span><span>等级${d.lv}级</span><button class="sm" onclick="G.openSv(${i})">管理</button></div>`; }).join("");
  const pickBtn = !p ? `<button class="primary" onclick="G.svStartPick()" ${s.stone < C.PICK_COST || n >= C.MAX ? "disabled" : ""}>选拔道童<small>${n >= C.MAX ? "道童已满" : U.fmt(C.PICK_COST) + " 灵石"}</small></button>`
    : p.end ? `<button disabled>选拔道童<small>${U.cd(Math.max(0, (p.end - this.now()) / 1000))}</small></button>`
    : `<button class="primary" onclick="G.svOpenPick()">选拔道童<small>已选出</small></button>`;
  const jobs = Object.keys(C.JOB).map(k => `<button onclick="G.svOpenJob('${k}')">${C.JOB[k].name}<small>${this.svEffTxt(k, this.servantPct(k))}</small></button>`).join("");
  return `<div class="card"><h3>${DATA.caveName("servant")}<small>道童 ${n} / ${C.MAX}</small></h3>
    ${rows}
    </div><div class="room-grid sv-jobs">${pickBtn}${jobs}</div>`;
};
