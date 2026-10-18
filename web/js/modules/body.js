/* =====================================================================
 * 模块：修炼肉身（数值在 config/body.js）
 * ---------------------------------------------------------------------
 * 需要学会肉身秘诀（宗门功法殿，gongfa 类型 tijue）。每 10 秒消耗灵气转化肉身修为，可开关自动修炼。
 * 肉身境界 bodyL：-1 = 凡体，0 = 第一境界一层 …… 24 境界 × 10 层。每层手动突破，不需要雷劫。
 * 突破扣除攒够的气血（肉身修为），另消耗灵石、药材；每突破一层增加属性（bodyBonus，加进 player.js computeStats）。
 * ===================================================================== */
G.module({
  id: "body",

  defaults: () => ({
    bodyL: -1,        // 肉身境界层序（-1 凡体）
    bodyExp: 0,       // 肉身修为
    bodyAuto: false,  // 自动修炼肉身
  }),

  tick() {
    const s = this.s, B = CFG.body;
    if (!s.bodyAuto || !this.hasTijue() || this.exBlocksCult() || this.bodyMax()) return;
    const sp = this.bodySpeed().total, rate = Math.max(0.0001, B.LING_RATE || 1), red = this.wdRed("body");   // red：神魂之道减掉的灵气消耗
    // 灵气不够且开了聚灵阵自动补充：用灵石补（和修为修炼一样）
    if (s.ling < sp * rate - red && s.array && s.array.autoRefill && s.stone >= 1) {
      const per = this.lingPerStone(), pay = Math.min(Math.ceil((sp * rate - red - s.ling) / per), Math.floor(s.stone));
      s.stone -= pay; s.ling += pay * per;
    }
    const per = Math.max(0, sp * rate - red) / Math.max(1e-9, sp), gain = per > 0 ? Math.min(sp, Math.floor(s.ling / per)) : sp;   // 每点肉身修为的灵气，按比例
    if (gain <= 0) return;
    s.ling = Math.max(0, s.ling - gain * per); s.bodyExp += gain;
  },

  api: {
    // 肉身此刻是否在自动修炼（进度条用）
    bodyActive() { return !!this.s.bodyAuto && this.hasTijue() && !this.exBlocksCult() && !this.bodyMax() && this.s.ling >= 1; },
    hasTijue() { return this.hasGfStat("body"); },   // 任意一本肉身秘诀（tijue / tijue2 / tijue3 …）
    bodyMaxL() { return CFG.body.names.length * DATA.LAYERS - 1; },
    bodyMax() { return this.s.bodyL >= this.bodyMaxL(); },
    // 肉身境界名：凡体 / 淬皮一层
    bodyName(L) { if (L === undefined) L = this.s.bodyL; return L < 0 ? "凡体" : CFG.body.names[Math.floor(L / DATA.LAYERS)] + DATA.layerNames[L % DATA.LAYERS]; },
    // 升到第 T 层（= bodyL + 1）需要的肉身修为
    bodyNeed(T) { if (T === undefined) T = this.s.bodyL + 1; return DATA.brNeed(CFG.realm.BODY_EXP, T, CFG.realm.BODY_EXP_RATE); },   // config/realm.js 的 BODY_EXP
    // 肉身修炼速度（每 10 秒）
    bodySpeed() {
      const s = this.s, base = (CFG.body.BASE_SPEED || 0) * Math.pow(CFG.body.SPEED_GROW, s.mortal ? 0 : s.L);
      const M = this.mifaBonus(), gf = this.gongfaBonus().body || 0, mf = M.bodySpeed || 0, pct = (M.bodySpeedPct || 0) + (this.servantPct ? this.servantPct("cult") : 0);   // 炼体秘法圆满额外 % + 道童辅助修炼 %
      return { base, gf, mf, pct, total: Math.floor((base + gf + mf) * (1 + pct / 100)) };
    },
    // 突破到第 T 层的消耗
    bodyCost(T) {
      const B = CFG.body, s = this.s; if (T === undefined) T = s.bodyL + 1;
      const ri = Math.floor(T / DATA.LAYERS), seg = (B.HERB_SEG || []).find(g => ri >= g.from && ri <= g.to);
      let n, herbs;
      if (seg) {   // 分段规则：(base + step × 段内层数) × 凡界 / 仙界倍率
        const k = T - seg.from * DATA.LAYERS, mult = seg.mult === "xian" ? B.HERB_MULT_XIAN : B.HERB_MULT_FAN;
        n = Math.max(1, Math.round((seg.base + seg.step * k) * (mult === undefined ? 1 : mult))); herbs = seg.herbs;
      } else {     // 不在分段里的境界（神体及以上）：HERB_XIAN_BASE × HERB_RATE^(T − HERB_FROM × 10)
        n = Math.max(1, Math.round(B.HERB_XIAN_BASE * Math.pow(B.HERB_RATE, T - B.HERB_FROM * DATA.LAYERS))); herbs = B.HERBS_XIAN;
      }
      return { stone: Math.floor(B.STONE_BASE * Math.pow(B.STONE_RATE, T)),
        herbs: herbs.map(name => ({ name, n })) };
    },
    // 按名字数 / 扣药材（凡界药材或 content/items.js 的自定义物品）
    herbCount(name) { const m = DATA.matByName[name]; if (m) return this.countMat(m.kind, m.g); return this.s.bag.reduce((a, it) => a + (it.t === "cu" && it.name === name ? it.n : 0), 0); },
    herbTake(name, n) {
      const m = DATA.matByName[name]; if (m) return this.takeMat(m.kind, m.g, n);
      for (let i = this.s.bag.length - 1; i >= 0 && n > 0; i--) { const it = this.s.bag[i]; if (it.t !== "cu" || it.name !== name) continue; const k = Math.min(n, it.n); this.removeAt(i, k); n -= k; }
    },
    bodyBlock() {
      const s = this.s; if (this.bodyMax()) return "已达肉身极境";
      const c = this.bodyCost();
      if (s.bodyExp < this.bodyNeed()) return `气血未满，还差 ${U.fmt(this.bodyNeed() - s.bodyExp)}`;
      if (s.stone < c.stone) return "灵石不足";
      if (c.herbs.some(h => this.herbCount(h.name) < h.n)) return "药材不足";
      return "";
    },
    bodyBreak() {
      const s = this.s, why = this.bodyBlock(); if (why) return this.log(why + "。", "sys");
      const c = this.bodyCost();
      s.bodyExp -= this.bodyNeed(); s.stone -= c.stone;
      c.herbs.forEach(h => this.herbTake(h.name, h.n));
      s.bodyL++; this.dirty();
      this.log(`肉身突破至【${this.bodyName()}】！`, s.bodyL % DATA.LAYERS === 0 ? "gold" : "good");
      this.after();
    },
    toggleBodyAuto() { this.s.bodyAuto = !this.s.bodyAuto; this.log(this.s.bodyAuto ? "开启自动修炼肉身。" : "停止自动修炼肉身。", "sys"); this.after(); },
    // 肉身突破加的属性合计（config/realm.js 的 BODY_GAIN，每层固定值）+ 宗门练体池
    bodyBonus() {
      const n = (this.s.bodyL === undefined ? -1 : this.s.bodyL) + 1, out = { hp: 0, atk: 0, def: 0, mana: 0, speed: 0, hit: 0, dodge: 0, crit: 0, res: 0 };
      const pg = this.s.poolGain || {}; for (const k in out) out[k] += (pg[k] || 0) + DATA.bodyStat(n, k);   // 宗门练体池加的（sect.js）
      return out;
    },
    bodyView() {
      const s = this.s, B = CFG.body, sp = this.bodySpeed(), has = this.hasTijue(), max = this.bodyMax(), cap = this.lingCap();
      const need = this.bodyNeed(), c = max ? null : this.bodyCost(), why = this.bodyBlock(), bb = this.bodyBonus();
      const status = !s.bodyAuto ? "未修炼" : !has ? "<b class='q5'>未学肉身秘诀</b>" : this.exBlocksCult() ? "<b class='q5'>历练 / 探索中，无法修炼</b>" : max ? "已达极境" : s.ling < 1 ? "<b class='q5'>灵气耗尽</b>" : "自动修炼中";
      const names = { hp: "生命", atk: "攻击", def: "防御", mana: "法力", speed: "速度", hit: "命中", dodge: "闪避", crit: "暴击%", res: "各系抗性" };
      const bonus = Object.keys(names).filter(k => bb[k]).map(k => `<div><span>${names[k]}</span>+${k === "crit" ? U.num(bb[k]) : U.fmt(bb[k])}</div>`).join("");
      return `<div class="card"><h3>修炼肉身 · ${this.bodyName()}<small>${s.bodyL < 0 ? "" : `第 ${Math.floor(s.bodyL / DATA.LAYERS) + 1} / ${B.names.length} 境`}</small></h3>
        ${has ? "" : `<p class="desc q5">需要先学会一本肉身秘诀（宗门 → 功法殿）。</p>`}
        <div class="row small"><span>肉身修炼速度 <b class="q4">${U.num(sp.total)}</b> / 10秒</span><span>${status}</span></div>
        <p class="desc">基础 ${U.num(sp.base)} + 肉身秘诀 ${U.num(sp.gf)} + 炼体秘法 ${U.num(sp.mf)}</p>
        <div class="bar tick"><div id="body-bar" style="width:${this.bodyActive() ? this.tickPct() : 0}%"></div></div>
        <div class="row small"><span>灵气</span><span>${U.fmt(s.ling)} / ${U.fmt(cap)}</span></div>
        <div class="bar ling"><div style="width:${Math.min(100, s.ling / cap * 100)}%"></div></div>
        <div class="btns">
          <button class="${s.bodyAuto ? "on" : "primary"}" onclick="G.toggleBodyAuto()">自动修炼肉身：${s.bodyAuto ? "开" : "关"}</button>
          <button onclick="G.openBody(false)">返回修炼</button>
          <button class="primary" style="flex-basis:100%" onclick="G.bodyBreak()" ${why ? "disabled" : ""}>${max ? "已达肉身极境" : why || `突破至${this.bodyName(s.bodyL + 1)}`}</button>
        </div>
        ${max ? "" : `<div class="row small" style="margin-top:8px"><span>气血</span><span>${U.fmt(s.bodyExp)} / ${U.fmt(need)}</span></div>
        <div class="bar"><div style="width:${Math.min(100, s.bodyExp / need * 100)}%"></div></div>
        <p class="desc">突破消耗：<span class="${s.stone >= c.stone ? "" : "q5"}">灵石 ${U.fmt(c.stone)}</span>、${c.herbs.map(h => { const hv = this.herbCount(h.name); return `<span class="${hv >= h.n ? "" : "q5"}">${h.name} ${U.fmt(hv)}/${U.fmt(h.n)}</span>`; }).join("、")}</p>`}
        </div>
        <div class="card"><h3>肉身加成<small>已突破 ${s.bodyL + 1} 层</small></h3>${bonus ? `<div class="stats">${bonus}</div>` : `<p class="desc">尚未突破，突破后每层增加属性。</p>`}</div>`;
    },
  },
});
