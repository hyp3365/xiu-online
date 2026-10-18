/* =====================================================================
 * 模块：丹方、炼丹房、炼器室
 * ---------------------------------------------------------------------
 * 丹方：在 门派 → 炼丹房 学习（消耗贡献 + 时间，一次学一个），学会后才在洞府炼丹房显示。
 *   学习星级见 config/alchemy.js 的 CAT_STAR / STAR_TIERS；凡丹 7 种属性丹 + 3 种修炼丹，仙冥魔神丹各 7 种（仙丹另有 3 种仙界修炼丹）。
 * 图纸：门派 → 宗门宝库 兑换后放进背包，在背包点「学习」才能炼制该炉子。
 * 炉子：炼丹炉、炼器炉都在 洞府 · 炼器室 炼制（必须装有炼器炉，炼器炉缩短炼制时间），
 *   炼好的炉子放进背包，在背包点「使用」后装进洞府；洞府炼丹房 / 炼器室可随时更换使用哪一个。
 *   宗门宝库「杂物」可直接兑换一阶炼丹炉、一阶炼器炉。
 * 炼丹：必须装有炼丹炉，丹阶不能高于炼丹炉阶；只消耗药材，一炉可连续炼多枚，出炉放进背包。
 * 全部数值在 js/config/ 数值文件 的 alchemy / furnace。按 G.now() 计时，离线也会继续。
 * 存档：
 *   recipes    ["atk|0", "juqi|0", ...]          已学会的丹方（类型|阶）
 *   danStudy   { key, end } | null              正在学习的丹方
 *   blueprints { dan: [阶...], qi: [阶...] }      已学会的图纸
 *   furnaces   { dan: [阶...], qi: [阶...] }      已装进洞府的炉子
 *   furnaceUse { dan: 阶|-1, qi: 阶|-1 }          正在使用的炉子
 *   forgeJob   { kind, g, end } | null           炼器室正在炼制的炉子
 *   forgeQueue [{ kind, g }]                     炼器室队列（排队时已扣材料）
 *   alchJob    { type, g, n, done, next, per } | null  正在炼的丹
 *   alchQueue  [{ type, g, n }]                   炼丹队列（排队时已扣药材）
 *   danEaten   { "atk|0": 已服用枚数 }
 *   forgeKnown ["eq:weapon:0", "ss:0", ...]      门派炼器室学会的装备图谱 / 空间石（v21）
 *   forgeStudy { key, end } | null              正在学习的炼器图谱
 *   stoneUsed  { 阶: 已使用空间石个数 }
 *   炼器室队列项 kind：dan/qi 炉子、eq 装备（slot、prev = 已扣的上一阶装备、ft = 法宝种类）、ss 空间石
 *   craftsman  { dan: { lv, exp }, qi: {...}, ling: {...} }  炼丹师 / 炼器师 / 灵植夫（config/craftsman.js）
 * 炼丹、炼器都有成功率（config/craftsman.js），失败只扣材料。
 * ===================================================================== */
G.module({
  id: "craft",

  defaults: () => ({
    recipes: [], danStudy: null,
    blueprints: { dan: [], qi: [], xdan: [], xqi: [] },
    furnaces: { dan: [], qi: [], xdan: [], xqi: [] },
    furnaceUse: { dan: -1, qi: -1, xdan: -1, xqi: -1 },   // xdan 炼丹仙炉、xqi 炼器仙炉（v42）
    forgeJob: null,
    forgeQueue: [],
    alchJob: null,
    alchQueue: [],
    danEaten: {},
    forgeKnown: [], forgeStudy: null, stoneUsed: {},
    craftsman: { dan: { lv: 1, exp: 0 }, qi: { lv: 1, exp: 0 }, ling: { lv: 1, exp: 0 } },   // v42 起还有 xdan 炼丹仙师 / xqi 炼器仙师 / xling 仙植师（用到时自动加）
  }),

  tick() { this.craftTick(); },

  api: {
    /* ---------- 炼丹师 / 炼器师 / 灵植夫 ---------- */
    craftInfo(k) {
      const s = this.s; if (!s.craftsman) s.craftsman = {};
      if (!s.craftsman[k]) s.craftsman[k] = { lv: 1, exp: 0 };
      return s.craftsman[k];
    },
    craftLv(k) { return this.craftInfo(k).lv; },
    // 加经验，满了升阶
    addCraftExp(k, n) {
      const C = CFG.craftsman, c = this.craftInfo(k), E = C[k].EXP || C.EXP;
      if (!(n > 0) || c.lv >= C.MAX) return;
      c.exp += n;
      while (c.lv < C.MAX && c.exp >= E[c.lv - 1]) {
        c.exp -= E[c.lv - 1]; c.lv++;
        if (!this.silent) this.log(`${C[k].name}晋升 ${c.lv} 阶！`, "gold");
      }
      if (c.lv >= C.MAX) c.exp = 0;
    },
    // 成功率 0~1：RATE_BASE + (技艺阶 − 物品阶) × RATE_STEP + 秘法%，g = 物品阶序号（0 = 一阶）
    craftRate(k, g) {
      const C = CFG.craftsman, m = this.mifaBonus();
      const pct = C.RATE_BASE + (this.craftLv(k) - (g + 1)) * C.RATE_STEP + ((k === "dan" || k === "xdan" ? m.danRate : m.qiRate) || 0);
      return Math.max((C.RATE_MIN || 0) / 100, Math.min(1, pct / 100));
    },
    ratePct(r) { return `${Math.round(r * 1000) / 10}%`; },
    // 秘法缩短时间 %（有上限）
    // 时间减少 % 合计 = 炉子% + 秘法%（相加，不相乘），最多 TIME_CUT_MAX
    mifaCut(kind, add = 0) { const cap = (CFG.wudao.TIME_CUT_MAX || {})[kind]; const v = (this.mifaBonus()[kind] || 0) + add; return cap === undefined ? Math.min(100, v) : Math.min(cap, v); },
    // 技艺卡片（炼丹房、炼器室、灵药园顶部）
    craftsmanCard(k) {
      const C = CFG.craftsman, c = this.craftInfo(k), max = c.lv >= C.MAX, need = (C[k].EXP || C.EXP)[c.lv - 1] || 1, pg = k === "xling" ? DATA.FAN_HERB_N : 0;
      const eff = k === "ling" || k === "xling" ? `<p class="desc">${k === "xling" ? "仙界药材" : ""}生长时间 -${U.num(this.plantCut(pg))}% · 收获 +${U.num(this.plantYieldPct(pg))}%</p>` : "";   // 炼丹、炼器的成功率显示在每样物品上
      return `<div class="card"><h3>${C[k].name} · ${c.lv} 阶<small>${max ? "已满阶" : `经验 ${U.fmt(c.exp)} / ${U.fmt(need)}`}</small></h3>
        ${max ? "" : `<div class="bar"><div style="width:${Math.min(100, c.exp / need * 100)}%"></div></div>`}${eff}</div>`;
    },

    /* ---------- 材料 ---------- */
    countMat(kind, g) {
      if (kind === "sm") return this.smCount(g);   // 秘境专用材料（养神露）
      const name = DATA.matName(kind, g);
      return this.s.bag.reduce((a, it) => a + (it.t === "mat" && it.kind === kind && it.name === name ? it.n : 0), 0);
    },
    takeMat(kind, g, n) {
      if (kind === "sm") return void this.takeSm(g, n);
      const name = DATA.matName(kind, g);
      for (let i = this.s.bag.length - 1; i >= 0 && n > 0; i--) {
        const it = this.s.bag[i];
        if (it.t !== "mat" || it.kind !== kind || it.name !== name) continue;
        const k = Math.min(n, it.n); this.removeAt(i, k); n -= k;
      }
    },
    hasMats(list, times = 1) { return list.every(m => this.countMat(m.kind, m.g) >= m.n * times); },
    matsText(list, times = 1) {
      return list.map(m => { const have = this.countMat(m.kind, m.g), need = m.n * times;
        return `<span class="${have >= need ? "" : "q5"}">${DATA.matFull(m.kind, m.g)} ${U.fmt(have)}/${U.fmt(need)}</span>`; }).join("、");
    },
    giveBack(list, times = 1) { list.forEach(m => this.addMat(m.kind, DATA.matName(m.kind, m.g), m.g, m.n * times)); },

    /* ---------- 定时结算（每 10 秒，离线也会补算） ---------- */
    craftTick() {
      const s = this.s, now = this.now();
      this.fixCraft();
      // 丹方学习、图谱 / 图纸学习（v173 学习队列，gongfa.js lqTick）
      this.lqTick("dan"); this.lqTick("forge");
      // 炼器室：炼好放进背包（背包满就等着），队列自动衔接
      let j, guard = 0;
      while ((j = s.forgeJob) && now >= j.end && guard++ < 1000) {
        if (!this.finishForge(j)) break;
        s.forgeJob = null;
        const nx = s.forgeQueue.shift();
        if (nx) s.forgeJob = Object.assign({}, nx, { end: j.end + this.forgePer(nx.kind, nx.g) });
      }
      // 炼丹（一炉炼完自动开始队列里的下一炉）
      guard = 0;
      while (s.alchJob && guard++ < 1000) {
        const a = s.alchJob;
        while (a.done < a.n && now >= a.next) {
          // 每枚单独判定成功率；成功时再按秘法「丹灵」几率多出一颗
          const ok = Math.random() < this.craftRate(DATA.danCraft(a.type), a.g);
          if (ok) {
            if (!this.addDan(a.type, a.g, 1)) break;   // 背包满：等有空位
            a.ok = (a.ok || 0) + 1;
            if (Math.random() * 100 < (this.mifaBonus().danExtra || 0) && this.addDan(a.type, a.g, 1)) a.extra = (a.extra || 0) + 1;
          } else a.fail = (a.fail || 0) + 1;
          const ck = DATA.danCraft(a.type);
          this.addCraftExp(ck, (a.g + 1) * CFG.craftsman[ck].EXP_RATE * (ok ? 1 : CFG.craftsman.FAIL_EXP));
          a.done++; a.next += a.per;
        }
        if (a.done < a.n) break;
        s.alchJob = null;
        this.log(`${DATA.danName(a.type, a.g)} ×${a.n} 炼制完毕：成丹 ${a.ok || 0} 枚${a.extra ? `（额外多出 ${a.extra} 枚）` : ""}${a.fail ? `，失败 ${a.fail} 枚` : ""}。`, "gold");
        const nx = s.alchQueue.shift();
        if (nx) { const per = this.danPer(nx.type, nx.g); s.alchJob = { type: nx.type, g: nx.g, n: nx.n, done: 0, per, next: a.next - a.per + per }; }
      }
    },
    // 改了配置（炉子种类、阶数、丹方）后清掉存档里无效的数据
    fixCraft() {
      const s = this.s;
      for (const k of DATA.FURNACE_KINDS) {
        if (!s.blueprints[k]) s.blueprints[k] = [];
        if (!s.furnaces[k]) s.furnaces[k] = [];
        if (s.furnaceUse[k] === undefined) s.furnaceUse[k] = -1;
        s.blueprints[k] = s.blueprints[k].filter(g => g >= 0 && g < DATA.DAN_JIE_N);
        s.furnaces[k] = s.furnaces[k].filter(g => g >= 0 && g < DATA.DAN_JIE_N);
      }
      if (s.alchJob && !DATA.recipes[s.alchJob.type]) s.alchJob = null;
      s.alchQueue = s.alchQueue.filter(q => DATA.recipes[q.type]);
      if (s.bag.some(it => it.t === "dan" && !DATA.dans[it.type])) s.bag = s.bag.filter(it => it.t !== "dan" || DATA.dans[it.type]);
    },

    /* ---------- 门派炼丹房：学习丹方 ---------- */
    setDanLibTier(g) { this.danLibTier = g; this.render(); },
    learnRecipe(type, g) {
      const s = this.s, key = type + "|" + g, c = DATA.danLearnCost(type, g);
      if (s.recipes.includes(key)) return;
      if (!this.lqCan("dan", key)) return;   // v173 学习队列
      if (DATA.danStar(type, g) > this.sectInfo().star) return this.log(`需要 ${DATA.danStar(type, g)} 星及以上门派才能学习。`, "sys");
      if (s.contrib < c) return this.log("贡献不足。", "sys");
      s.contrib -= c; this.lqAdd("dan", { key, k: "dan", ms: DATA.danLearnTime(type, g) }); this.after();
    },

    /* ---------- 图纸、炉子（背包物品） ---------- */
    addBlueprintItem(kind, g) {
      if (this.bagFull()) { this.log("背包已满。", "bad"); return false; }
      this.s.bag.push({ t: "bp", kind, g }); return true;
    },
    addFurnaceItem(kind, g) {
      return this.bagAdd(x => x.t === "fu" && x.kind === kind && x.g === g, k => ({ t: "fu", kind, g, n: k }), 1, "背包已满，炉子无处存放，暂停出炉。");
    },
    // 背包里点图纸「学习」
    learnBlueprint(i) {
      const it = this.s.bag[i]; if (!it || it.t !== "bp") return;
      const bp = this.s.blueprints[it.kind];
      if (bp.includes(it.g)) return this.log("已学会该图纸。", "sys");
      if (it.lq) return;   // v173 学习中 / 排队中：学完才从背包消失
      const key = `bp|${it.kind}|${it.g}`; if (!this.lqCan("forge", key)) return;
      it.lq = 1; this.lqAdd("forge", { key, k: "bp", kind: it.kind, g: it.g, ms: this.bagLearnMs("BP_MIN", it.g) }); this.closeModal(); this.after();
    },
    // 背包里点炉子「使用」：装进洞府
    installFurnace(i) {
      const s = this.s, it = s.bag[i]; if (!it || it.t !== "fu") return;
      if (s.furnaces[it.kind].includes(it.g)) return this.log(`洞府里已有${DATA.furnaceName(it.kind, it.g)}。`, "sys");
      s.furnaces[it.kind].push(it.g); this.removeAt(i, 1);
      if (it.g > s.furnaceUse[it.kind]) s.furnaceUse[it.kind] = it.g;
      this.log(`${DATA.furnaceName(it.kind, it.g)}已装进洞府${DATA.isDanFu(it.kind) ? "炼丹房" : "炼器室"}。`, "gold"); this.closeModal(); this.after();
    },

    /* ---------- 炼器室：炉子 / 装备 / 空间石 ---------- */
    // 炼制时间（炼器炉缩短）
    forgePer(kind, g) {
      const base = kind === "eq" ? DATA.forgeEqTime(g) : kind === "ss" ? DATA.stoneTime(g) : kind === "ring" ? DATA.ringTime(g) : DATA.furnaceTime(kind, g);
      const xf = (kind === "xdan" || kind === "xqi") && this.s.furnaceUse.xqi >= 0;   // 仙炉：装有炼器仙炉时按炼器仙炉缩短
      const ck = this.forgeCraft(kind), tc = (CFG.craftsman[ck].TIME_CUT || [])[this.craftLv(ck) - 1] || 0;   // 炉子% + 炼器师/炼器仙师% + 器火秘法% 相加
      return Math.ceil(base * (1 - this.mifaCut("qiTime", (xf ? DATA.furnaceBonus("xqi", this.s.furnaceUse.xqi) : DATA.furnaceBonus("qi", this.s.furnaceUse.qi)) + tc + this.servantPct("qi")) / 100));
    },
    // 秘境专用材料：空间石要空间晶核；装备 / 戒指 / 法宝要耀石（config/forge.js 的 YAOSHI）→ [{ k, ft, n }]
    //   法宝用同属性耀石（q.el），装备、戒指任意一种（ft = -1）
    jobSm(q) {
      if (q.kind === "ss") { const n = (CFG.forge.stone.special || [])[q.g] || 0; return n ? [{ k: "kj", n }] : []; }
      const out = [];
      if (q.kind === "eq" || q.kind === "ring") {
        const fb = q.slot === "fabao", J = CFG.forge.YAOSHI || {}, n = (J[q.kind === "ring" ? "ring" : fb ? "fabao" : "equip"] || [])[q.g] || 0;
        if (n) out.push({ k: "ys", ft: fb ? DATA.elIdx(q.el) : -1, n });
      }
      return out;
    },
    smHave(list) { return list.every(x => this.smCount(x.k, x.ft) >= x.n); },
    smText(list) { return list.map(x => `<span class="${this.smCount(x.k, x.ft) >= x.n ? "" : "q5"}">${DATA.li(DATA.smIcon(x.k, x.ft))}${DATA.smName(x.k, x.ft)} ${U.fmt(this.smCount(x.k, x.ft))}/${U.fmt(x.n)}</span>`).join("、"); },
    jobMats(q) { return q.kind === "eq" ? DATA.forgeEqMats(q.g) : q.kind === "ss" ? DATA.stoneMats(q.g) : q.kind === "ring" ? DATA.ringMats(q.g) : DATA.furnaceMats(q.kind, q.g); },
    jobName(q) { return q.kind === "eq" ? (q.slot === "fabao" && q.ft !== undefined ? DATA.JIE[q.g] + "·" + (DATA.elById[q.el] ? DATA.elById[q.el].name + "·" : "") + DATA.fabaoName(q.ft, q.g) : DATA.forgeEqName(q.slot, q.g)) : q.kind === "ss" ? DATA.stoneName(q.g) : q.kind === "ring" ? DATA.ringName(q.r, q.g) : DATA.furnaceName(q.kind, q.g); },
    // 炼好：放进背包，背包满返回 false（等有空位再出炉）
    forgeCraft(kind) { return kind === "xdan" || kind === "xqi" ? "xqi" : "qi"; },   // 仙炉按炼器仙师算
    finishForge(j) {
      // 成功率判定（只判一次，背包满等待时不重复判定、不重复加经验）
      if (j.ok === undefined) {
        const ck = this.forgeCraft(j.kind);
        j.ok = Math.random() < this.craftRate(ck, j.g);
        this.addCraftExp(ck, (j.g + 1) * CFG.craftsman[ck].EXP_RATE * (j.ok ? 1 : CFG.craftsman.FAIL_EXP));
      }
      if (!j.ok) {
        if (j.prev) { if (this.bagFull()) { if (!this.silent) this.log("背包已满，暂停出炉。", "bad"); return false; } this.addEquip(j.prev); }
        this.log(`${this.jobName(j)}炼制失败，材料已耗尽${j.prev ? "（上一阶装备已退回背包）" : ""}。`, "bad"); return true;
      }
      if (j.kind === "eq" || j.kind === "ring") {
        if (this.bagFull()) { if (!this.silent) this.log("背包已满，装备暂停出炉。", "bad"); return false; }
        // v25：升阶（有上一阶装备）→ 属性颜色不变，只是数值按新阶变大；一阶 → 随机生成
        const e = j.prev && j.prev.attrs ? DATA.upgradeForged(j.prev, j.g) : DATA.rollForged(j.kind === "ring" ? "ring" : j.slot, j.g, j.kind === "ring" ? j.r : j.ft, j.el);
        this.addEquip(e);
        this.log(`炼成 <span class="q${e.q}">${this.itemName({ t: "eq", e })}</span>，已放进背包。`, "gold"); return true;
      }
      if (j.kind === "ss") { if (!this.addStone(j.g)) return false; this.log(`${DATA.stoneName(j.g)}炼制成功，已放进背包。`, "gold"); return true; }
      if (!this.addFurnaceItem(j.kind, j.g)) return false;
      this.log(`${DATA.furnaceName(j.kind, j.g)}炼制成功，已放进背包（点击「使用」装进洞府）。`, "gold"); return true;
    },
    // 背包里上一阶同部位的炼器装备（优先颜色最差的）
    //   v25：戒指要同种（r）；优先颜色最好的（升阶颜色不变）
    //   法宝：r = 形状序号、el = 属性（要同形状同属性）；多件时优先强化等级高的
    prevEquipIndex(slot, g, r, el) {
      let best = -1;
      const same = e => r === undefined || (slot === "fabao" ? e.ft === r && (!el || e.el === el) : e.r === r);
      const score = e => (e.enh || 0) * 10 + e.q;
      this.s.bag.forEach((it, i) => { if (it.t === "eq" && it.e.attrs && it.e.slot === slot && it.e.g === g - 1 && same(it.e) && (best < 0 || score(it.e) > score(this.s.bag[best].e))) best = i; });
      return best;
    },
    // 炼制：空闲就开始，否则加入队列（都会先扣材料）。kind = dan/qi 炉子、eq 装备/法宝（slot）、ss 空间石、ring 戒指（slot 传戒指种类序号）
    //   法宝：slot = "fabao"，ft = 形状序号，el = 属性
    craftFurnace(kind, g, slot, ft, el) {
      const s = this.s, q = s.forgeQueue, job = { kind, g };
      if (kind === "ring") job.r = +slot; else if (slot) job.slot = slot;
      if (slot === "fabao") { if (!DATA.fabaoTypes[ft] || !DATA.elById[el]) return this.openFabaoPick(g); job.ft = +ft; job.el = el; }
      const mats = this.jobMats(job);
      if (s.furnaceUse.qi < 0) return this.log("炼器必须装有炼器炉（宗门宝库 · 杂物可兑换一阶炼器炉）。", "sys");
      if (DATA.FURNACE_KINDS.includes(kind)) { if (!s.blueprints[kind].includes(g)) return this.log("尚未学会该图纸。", "sys"); }
      else {
        if (kind === "ring" ? !this.ringKnown(job.r, g) : !s.forgeKnown.includes(this.forgeKey(kind, g, slot))) return this.log(kind === "ring" ? "尚未学会这张戒指图纸（试炼塔奖励）。" : "尚未学会，去门派炼器室学习。", "sys");
        if (s.furnaceUse.qi < Math.min(g, DATA.DAN_JIE_N - 1)) return this.log(`需要使用${DATA.JIE[Math.min(g, DATA.DAN_JIE_N - 1)]}及以上炼器炉。`, "sys");
      }
      if (s.forgeJob && q.length >= CFG.furnace.QUEUE) return this.log(`队列已满（最多 ${CFG.furnace.QUEUE} 个）。`, "sys");
      const sm = this.jobSm(job);
      if (!this.hasMats(mats) || !this.smHave(sm)) return this.log(sm.length && !this.smHave(sm) ? `缺少${sm.filter(x => this.smCount(x.k, x.ft) < x.n).map(x => DATA.smName(x.k, x.ft)).join("、")}（秘境、灵地掉落）。` : "材料不足。", "sys");
      let pi = -1;
      if (kind === "ring" && g < 1) return;
      if (kind === "eq" && g > 0) { pi = this.prevEquipIndex(slot, g, job.ft, job.el); if (pi < 0) return this.log(`需要一件${slot === "fabao" ? DATA.JIE[g - 1] + "·" + DATA.elById[job.el].name + "·" + DATA.fabaoName(job.ft, g - 1) : DATA.forgeEqName(slot, g - 1)}。`, "sys"); }
      if (kind === "ring") { pi = this.prevEquipIndex("ring", g, job.r); if (pi < 0) return this.log(`需要一枚${DATA.ringName(job.r, g - 1)}。`, "sys"); }
      if (pi >= 0) { job.prev = s.bag[pi].e; s.bag.splice(pi, 1); }
      mats.forEach(m => this.takeMat(m.kind, m.g, m.n));
      job.sm = []; sm.forEach(x => { const got = this.takeSm(x.k, x.n, x.ft); if (got) job.sm.push(...got); });   // 记下实际扣的（取消时按这个退）
      if (s.forgeJob) { q.push(job); this.log(`${this.jobName(job)}加入队列。`, "sys"); }
      else { s.forgeJob = Object.assign(job, { end: this.now() + this.forgePer(kind, g) }); this.log(`开始炼制${this.jobName(job)}。`, "good"); }
      if (slot === "fabao") this.closeModal();
      this.after();
    },
    // 法宝：先选属性（上面一排），再选形状炼制（7 种）
    setFabaoEl(g, el) { this._fbEl = el; this.openFabaoPick(g); },
    openFabaoPick(g) {
      const s = this.s, mats = DATA.forgeEqMats(g), full = s.forgeJob && s.forgeQueue.length >= CFG.furnace.QUEUE;
      const el = DATA.elById[this._fbEl] ? this._fbEl : DATA.elements[0].id, ok0 = s.furnaceUse.qi >= g && this.hasMats(mats) && !full;
      const sm = this.jobSm({ kind: "eq", g, slot: "fabao", el }), smOK = this.smHave(sm);
      const els = `<div class="room-grid five">${DATA.elements.map((x, i) => `<button class="${x.id === el ? "active" : ""}" onclick="G.setFabaoEl(${g},'${x.id}')">${DATA.li(DATA.smIcon("ys", i))}${x.name} ${U.fmt(this.smCount("ys", i))}</button>`).join("")}</div>`;
      this.modal(`<h2>炼制${DATA.JIE[g]}法宝</h2>${els}<p class="desc">${g ? `${DATA.JIE[g - 1]}同形状同属性法宝 ×1、` : ""}${this.matsText(mats)}${sm.length ? "、" + this.smText(sm) : ""} · ${U.dur(this.forgePer("eq", g) / 1000)} · 成功率 ${this.ratePct(this.craftRate("qi", g))}</p>` +
        DATA.fabaoTypes.map((T, ft) => {
          const prevOK = g === 0 || this.prevEquipIndex("fabao", g, ft, el) >= 0;
          return `<div class="line"><div>${DATA.eqTierIco(DATA.iconImg("fbs" + ft + "_" + DATA.elIdx(el)), g)}${DATA.JIE[g]}·${DATA.elById[el].name}·${DATA.fabaoName(ft, g)}
            <small>${g ? `<span class="${prevOK ? "" : "q5"}">${DATA.JIE[g - 1]}·${DATA.elById[el].name}·${DATA.fabaoName(ft, g - 1)} ×1</span>` : ""}</small></div>
            <button class="sm" onclick="G.craftFurnace('eq',${g},'fabao',${ft},'${el}')" ${ok0 && smOK && prevOK ? "" : "disabled"}>${s.forgeJob ? "排队" : "炼制"}</button></div>`;
        }).join("") +
        `<div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    // 背包里有没有能炼这一阶法宝的底子：一阶不需要，二阶起 = 任意一件上一阶法宝
    fabaoAnyBase(g) { return g === 0 || this.prevEquipIndex("fabao", g) >= 0; },
    // 退回：按开始时实际扣的专用材料 q.sm
    refundJob(q) { this.giveBack(this.jobMats(q)); (q.sm || []).forEach(x => this.addSm(x.k, x.n, x.ft)); if (q.prev) this.addEquip(q.prev); },
    // 取消队列中的一项，退回材料
    cancelForgeQ(i) {
      const q = this.s.forgeQueue[i]; if (!q) return;
      this.s.forgeQueue.splice(i, 1); this.refundJob(q);
      this.log(`取消${this.jobName(q)}，材料已退回。`, "sys"); this.after();
    },
    // 停止正在炼制的，退回材料，队列下一个马上开始
    stopForge() {
      const s = this.s, j = s.forgeJob; if (!j) return;
      this.refundJob(j); s.forgeJob = null;
      const nx = s.forgeQueue.shift();
      if (nx) s.forgeJob = Object.assign({}, nx, { end: this.now() + this.forgePer(nx.kind, nx.g) });
      this.log(`停止炼制${this.jobName(j)}，材料已退回。`, "sys"); this.after();
    },
    setForgeTier(g) { this.forgeTier = g; this.render(); },

    /* ---------- 门派炼器室：学习装备图谱 / 空间石 ---------- */
    // 戒指图纸 key：v26 起 ring:种类:阶（v25 的 ring:阶 = 该阶所有种类）
    forgeKey(kind, g, slot) { return kind === "lz" ? `lz:${slot}` : kind === "eq" ? `eq:${slot}:${g}` : kind === "ring" ? (slot === undefined ? `ring:${g}` : `ring:${slot}:${g}`) : `ss:${g}`; },
    forgeKeyName(key) { const p = key.split(":"), k = p[0]; return k === "lz" ? DATA.smName("lz", +p[1]) + "图纸" : k === "eq" ? DATA.forgeEqName(p[1], +p[2]) + "图谱" : k === "ring" ? (p.length > 2 ? DATA.ringBpName(+p[2], +p[1]) : DATA.ringBpName(+p[1])) : DATA.stoneName(+p[1]) + "炼法"; },
    ringKnown(r, g) { const K = this.s.forgeKnown; return K.includes(`ring:${r}:${g}`) || K.includes(`ring:${g}`); },
    // v25：使用戒指图纸（试炼塔奖励）→ 学会该阶 9 种戒指的炼法
    learnRingBp(i) {
      const s = this.s, it = s.bag[i]; if (!it || it.t !== "rbp") return;
      const key = this.forgeKey("ring", it.g, it.r);
      if (it.r === undefined ? s.forgeKnown.includes(key) : this.ringKnown(it.r, it.g)) return this.log("已学会这张图纸。", "sys");
      if (it.lq || !this.lqCan("forge", key)) return;   // v173 学习队列：学完才从背包消失
      it.lq = 1; this.lqAdd("forge", { key, k: "rbp", g: it.g, r: it.r, ms: this.bagLearnMs("RBP_MIN", it.g) }); this.closeModal(); this.after();
    },
    // v173 背包图纸学习时间（毫秒）：config/gongfa.js LEARN_Q 的 BP_MIN / RBP_MIN，不写 = 同阶装备图谱学习时间
    bagLearnMs(k, g) { const a = (CFG.gongfa.LEARN_Q || {})[k], T = CFG.forge.equip.learnTime; const v = a && a[g] !== undefined ? a[g] : T[Math.min(T.length - 1, Math.max(0, g))]; return (v || 0) * 60000; },
    setForgeLibTier(g) { this.forgeLibTier = g; this.render(); },
    // 学习花费 { c 贡献, min 分钟 }（灵珠图纸不分阶，见 config/array.js 的 CFG.lingzhu）
    forgeLearnOf(kind, g) { if (kind === "lz") return { c: CFG.lingzhu.LEARN_COST, min: CFG.lingzhu.LEARN_TIME }; const C = kind === "eq" ? CFG.forge.equip : CFG.forge.stone; return { c: C.learnCost[g], min: C.learnTime[g] }; },
    learnForge(kind, g, slot) {
      const s = this.s, key = this.forgeKey(kind, g, slot), L = this.forgeLearnOf(kind, g), c = L.c;
      if (s.forgeKnown.includes(key)) return;
      if (!this.lqCan("forge", key)) return;   // v173 学习队列
      if (kind !== "lz" && g >= this.sectInfo().star) return this.log(`需要 ${g + 1} 星及以上门派才能学习。`, "sys");
      if (s.contrib < c) return this.log("贡献不足。", "sys");
      s.contrib -= c; this.lqAdd("forge", { key, k: "forge", ms: L.min * 60000 }); this.after();
    },
    /* ---------- 灵珠：洞府炼器室炼制（三种矿石 + 对应灵晶，立即炼成放进背包） ---------- */
    lzMats() { return DATA.parseMats(CFG.lingzhu.ORE); },
    craftLz(ft) {
      const C = CFG.lingzhu, mats = this.lzMats();
      if (!this.s.forgeKnown.includes(this.forgeKey("lz", 0, ft))) return;
      if (!this.hasMats(mats) || this.smCount("lj", ft) < C.JING) return this.log("材料不足。", "sys");
      if (!this.addSm("lz", 1, ft)) return;
      mats.forEach(m => this.takeMat(m.kind, m.g, m.n)); this.takeSm("lj", C.JING, ft);
      this.log(`炼成${DATA.smName("lz", ft)}，放进聚灵阵的灵珠格可增加聚灵。`, "gold"); this.after();
    },

    /* ---------- 空间石 ---------- */
    addStone(g, n = 1) {
      return this.bagAdd(x => x.t === "ss" && x.g === g, k => ({ t: "ss", g, n: k }), n, `背包已满，${DATA.SS}暂停出炉。`);
    },
    stoneLeft(g) { return CFG.forge.stone.MAX_USE - ((this.s.stoneUsed || {})[g] || 0); },
    useStone(i, n) {
      const s = this.s, it = s.bag[i]; if (!it || it.t !== "ss") return;
      n = Math.min(n, it.n, this.stoneLeft(it.g));
      if (n <= 0) return this.log(`${DATA.stoneName(it.g)}已达使用上限（每阶 ${CFG.forge.stone.MAX_USE} 个）。`, "sys");
      s.stoneUsed[it.g] = (s.stoneUsed[it.g] || 0) + n; s.bagCap += n;
      this.log(`使用${DATA.stoneName(it.g)} ×${n}，储物格 +${n}（共 ${s.bagCap} 格）。`, "good");
      this.removeAt(i, n); this.closeModal(); this.after();
    },
    useFurnace(kind, g) {
      if (!this.s.furnaces[kind].includes(g)) return;
      this.s.furnaceUse[kind] = g; this.log(`换用${DATA.furnaceName(kind, g)}。`, "sys"); this.closeModal(); this.after();
    },
    // 更换炉子弹窗
    openFurnacePick(kind) {
      const s = this.s, own = s.furnaces[kind].slice().sort((a, b) => a - b);
      if (!own.length) return this.log(`洞府里还没有${DATA.furnaceKinds[kind]}。`, "sys");
      this.modal(`<h2>更换${DATA.furnaceKinds[kind]}</h2>` + own.map(g => `<div class="line"><div>${DATA.li(DATA.furnaceIcon(kind))}${DATA.furnaceName(kind, g)}<small>${this.furnaceDesc(kind, g)}</small></div>
        ${s.furnaceUse[kind] === g ? `<button class="sm on" disabled>使用中</button>` : `<button class="sm" onclick="G.useFurnace('${kind}',${g})">使用</button>`}</div>`).join("") +
        `<div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },

    /* ---------- 炼丹 ---------- */
    danPer(type, g) { const fk = DATA.danFu(type), ck = DATA.danCraft(type), tc = (CFG.craftsman[ck].TIME_CUT || [])[this.craftLv(ck) - 1] || 0;   // 炉子% + 炼丹仙师% + 丹火秘法% 相加
      return Math.ceil(DATA.danTime(type, g) * (1 - this.mifaCut("danTime", DATA.furnaceBonus(fk, this.s.furnaceUse[fk]) + tc + this.servantPct("dan")) / 100)); },
    setDanTier(g) { this.danTier = g; this.render(); },
    // 丹药分类（config/alchemy.js 的 CATS）：0 = 现有丹方，其余暂时没有丹方
    setDanCat(k, c) { this[k] = c; this.render(); },
    danCatBar(k) { const cur = this[k] || 0, C = CFG.alchemy.CATS || []; return C.length > 1 ? `<div class="room-grid five">${C.map((n, c) => `<button class="${cur === c ? "active" : ""}" onclick="G.setDanCat('${k}',${c})">${n}</button>`).join("")}</div>` : ""; },
    // 炼丹：丹炉空闲就开炉，否则加入队列（都会先扣药材）
    startAlch(type, g, n) {
      const s = this.s, rec = DATA.danRecipe(type, g);
      if (s.alchJob && s.alchQueue.length >= CFG.alchemy.QUEUE) return this.log(`炼丹队列已满（最多 ${CFG.alchemy.QUEUE} 个）。`, "sys");
      if (!s.recipes.includes(type + "|" + g)) return this.log("尚未学会该丹方。", "sys");
      const fk = DATA.danFu(type), fn = DATA.furnaceKinds[fk];
      if (s.furnaceUse[fk] < 0) return this.log(`炼${DATA.danCat(type) ? CFG.alchemy.CATS[DATA.danCat(type)] : "丹"}必须装有${fn}。`, "sys");
      if (s.furnaceUse[fk] < g) return this.log(`需要使用${DATA.JIE[g]}及以上${fn}。`, "sys");
      // n = 0 表示用现有药材能炼多少炼多少
      let max = CFG.alchemy.MAX_BATCH;
      for (const m of rec) max = Math.min(max, Math.floor(this.countMat(m.kind, m.g) / m.n));
      n = n ? Math.min(n, max) : max;
      if (n <= 0) return this.log("药材不足。", "sys");
      rec.forEach(m => this.takeMat(m.kind, m.g, m.n * n));
      if (s.alchJob) { s.alchQueue.push({ type, g, n }); this.log(`${DATA.danName(type, g)} ×${n} 加入炼丹队列。`, "sys"); return this.after(); }
      const per = this.danPer(type, g);
      s.alchJob = { type, g, n, done: 0, per, next: this.now() + per };
      this.log(`开炉炼制${DATA.danName(type, g)} ×${n}。`, "good"); this.after();
    },
    // 停炉：退还没炼的药材，队列里的下一炉马上开始
    stopAlch() {
      const s = this.s, a = s.alchJob; if (!a) return;
      const left = a.n - a.done;
      DATA.danRecipe(a.type, a.g).forEach(m => this.addMat(m.kind, DATA.matName(m.kind, m.g), m.g, m.n * left));
      s.alchJob = null;
      const nx = s.alchQueue.shift();
      if (nx) { const per = this.danPer(nx.type, nx.g); s.alchJob = { type: nx.type, g: nx.g, n: nx.n, done: 0, per, next: this.now() + per }; }
      this.log(`停炉，退回 ${left} 枚的药材。`, "sys"); this.after();
    },
    // 取消队列中的一项，退回药材
    cancelAlchQ(i) {
      const q = this.s.alchQueue[i]; if (!q) return;
      this.s.alchQueue.splice(i, 1);
      DATA.danRecipe(q.type, q.g).forEach(m => this.addMat(m.kind, DATA.matName(m.kind, m.g), m.g, m.n * q.n));
      this.log(`取消${DATA.danName(q.type, q.g)} ×${q.n}，药材已退回。`, "sys"); this.after();
    },

    /* ---------- 属性丹：背包、服用 ---------- */
    addDan(type, g, n = 1, sg) {
      if (DATA.recipeItem(type)) return this.addSm(DATA.recipeItem(type), n);   // 养神丹 → 专用材料
      if (DATA.isSpeedRecipe(type)) return this.addPill(type, DATA.pillGrade(type, g), n); // 修炼速度丹 → 背包修炼丹（品质 = 阶，仙界修炼丹 + REALM0）
      return this.bagAdd(x => x.t === "dan" && x.type === type && x.g === g && !x.sg === !sg, k => sg ? { t: "dan", type, g, n: k, sg: 1 } : { t: "dan", type, g, n: k }, n, "背包已满，丹药无处存放，暂停出炉。");
    },
    danLeft(type, g) { return DATA.danLimit(type, g) - (this.s.danEaten[type + "|" + g] || 0); },
    eatDan(i, n) {
      const it = this.s.bag[i]; if (!it || it.t !== "dan") return;
      n = Math.min(n, it.n, this.danLeft(it.type, it.g));
      if (n <= 0) return this.log(`${DATA.danName(it.type, it.g, it.sg)}已达服用上限。`, "sys");
      const key = it.type + "|" + it.g, d = DATA.dans[it.type];
      this.s.danEaten[key] = (this.s.danEaten[key] || 0) + n;
      this.log(`服下${DATA.danName(it.type, it.g, it.sg)} ×${n}，${d.label} +${U.num(DATA.danVal(it.type, it.g) * n)}。`, "good");
      this.removeAt(i, n); this.closeModal(); this.after();
    },
    // 所有已服用丹药的属性总和（computeStats 里用）
    danBonus() {
      const b = { atk: 0, def: 0, hp: 0, mana: 0, hit: 0, dodge: 0, crit: 0, speed: 0, res: 0 };   // speed、res（六系抗性）是 v41 魔丹 / 冥丹加的
      for (const key in this.s.danEaten) { const [t, g] = key.split("|"), k = DATA.danStat(t); if (k in b && DATA.dans[t]) b[k] += (DATA.danVal(t, +g) || 0) * this.s.danEaten[key]; }
      const q = this.qlBonus ? this.qlBonus() : {}; for (const k in q) if (k in b) b[k] += q[k];   // v213 宗主清灵丹
      return b;
    },

    /* ---------- 页面：炉子卡片（炼丹房、炼器室共用，可更换） ---------- */
    furnaceDesc(kind, g) { const d = DATA.isDanFu(kind); return `${d ? "炼丹" : kind === "xqi" ? "炼制仙炉" : "炼器"}时间 -${DATA.furnaceBonus(kind, g)}%${d ? ` · 可炼一阶~${DATA.JIE[g]}${kind === "xdan" ? "仙冥魔神丹" : "丹"}` : ""}`; },
    furnaceCard(kind) {
      const s = this.s, cur = s.furnaceUse[kind], n = s.furnaces[kind].length;
      return `<div class="card"><h3>${DATA.furnaceKinds[kind]}<small>洞府已有 ${n} 个</small></h3>
        <div class="line"><div>${DATA.li(DATA.furnaceIcon(kind))}${cur >= 0 ? `使用中：${DATA.furnaceName(kind, cur)}` : `尚未装${DATA.furnaceKinds[kind]}`}
          <small>${cur >= 0 ? this.furnaceDesc(kind, cur) : kind === "xdan" ? "炼仙丹、冥丹、魔丹、神丹必须装有炼丹仙炉：宗门宝库兑换图纸，在炼器室炼制，放进背包后点「使用」" : kind === "xqi" ? "装有后缩短炼制仙炉的时间：宗门宝库兑换图纸，在炼器室炼制" : `${kind === "dan" ? "炼丹" : "炼器"}必须装有${DATA.furnaceKinds[kind]}：宗门宝库 · 杂物兑换，或在炼器室炼制，放进背包后点「使用」`}</small></div>
          <button class="sm" onclick="G.openFurnacePick('${kind}')" ${n ? "" : "disabled"}>更换</button></div></div>`;
    },
  },
});

/* 洞府 · 炼丹房：按 一阶~九阶 分页，只显示已学会的丹方 */
G.caveViews.alchemy = function () {
  const s = this.s, a = s.alchJob, tier = this.danTier || 0, cat = this.danCat || 0, catName = (CFG.alchemy.CATS || [])[cat] || "";
  const fk = cat ? "xdan" : "dan", fu = s.furnaceUse[fk];   // 仙冥魔神丹：炼丹仙师 + 炼丹仙炉
  let h = this.danCatBar("danCat") + this.craftsmanCard(fk) + this.furnaceCard(fk);
  if (a) {
    const aLeft = Math.max(0, a.next - Date.now()) + Math.max(0, a.n - a.done - 1) * a.per; let aAcc = aLeft;   // 这一炉剩余 / 排到队列第几炉为止的总时间（毫秒）
    h += `<div class="card"><h3>丹炉中<small>${DATA.danName(a.type, a.g)} ${a.done} / ${a.n}</small></h3>
      <p class="desc">成丹 ${a.ok || 0}${a.extra ? `（额外 +${a.extra}）` : ""} · 失败 ${a.fail || 0} · 当前成功率 ${this.ratePct(this.craftRate(DATA.danCraft(a.type), a.g))}</p>
      <div class="line"><div class="pg">${this.pgFill(Math.max(0, a.next - Date.now()), a.per)}<span>下一枚出炉<small>${U.cd(Math.max(0, a.next - Date.now()) / 1000 + 59)} · 每枚 ${U.dur(a.per / 1000)} · 这一炉约 ${U.cd(aLeft / 1000 + 59)} 后炼完</small></span></div>
      <button class="sm" onclick="G.stopAlch()">停炉</button></div>` +
      s.alchQueue.map((q, i) => { const ms = this.danPer(q.type, q.g) * q.n; aAcc += ms;
        return `<div class="line"><div>队列 ${i + 1}：${DATA.danName(q.type, q.g)} ×${q.n}<small>需 ${U.dur(ms / 1000)} · 约 ${U.cd(aAcc / 1000 + 59)} 后完成</small></div><button class="sm" onclick="G.cancelAlchQ(${i})">取消</button></div>`; }).join("") +
      `<p class="desc">队列 ${s.alchQueue.length} / ${CFG.alchemy.QUEUE}，炼完自动开下一炉。</p></div>`;
  }
  const list = Object.keys(DATA.recipes).filter(t => DATA.danCat(t) === cat && DATA.recipeHas(t, tier) && s.recipes.includes(t + "|" + tier));
  h += `<div class="card"><h3>炼丹<small>${fu >= 0 ? `可炼一阶~${DATA.JIE[fu]}` : `需要${DATA.furnaceKinds[fk]}`} · 已学丹方 ${s.recipes.length}</small></h3>
    <div class="room-grid five">${DATA.JIE.slice(0, DATA.DAN_JIE_N).map((n, g) => `<button class="${tier === g ? "active" : ""}" onclick="G.setDanTier(${g})">${n}</button>`).join("")}</div>` +
    (list.length ? list.map(t => {
      const rec = DATA.danRecipe(t, tier), ok = fu >= tier && this.hasMats(rec) && !(a && s.alchQueue.length >= CFG.alchemy.QUEUE);
      const eaten = !DATA.dans[t] ? "" : ` · 已服 ${DATA.danLimit(t, tier) - this.danLeft(t, tier)}/${DATA.danLimit(t, tier)}`;
      return `<div class="line"><div>${DATA.danImg(DATA.danIcon(t), DATA.danCls(t, tier), "li")}${DATA.danName(t, tier)}<span class="tag">${DATA.recipeEffect(t, tier)}</span>
        <small>${this.matsText(rec)} · 每枚 ${U.dur(this.danPer(t, tier) / 1000)} · 成功率 ${this.ratePct(this.craftRate(fk, tier))}${eaten}</small></div>
        <div><button class="sm" onclick="G.startAlch('${t}',${tier},1)" ${ok ? "" : "disabled"}>${a ? "排1" : "炼1"}</button>
        <button class="sm" onclick="G.startAlch('${t}',${tier},0)" ${ok ? "" : "disabled"}>全部</button></div></div>`;
    }).join("") : `<p class="desc">尚未学会${DATA.JIE[tier]}${cat ? catName : ""}丹方，可在门派 → 炼丹房学习。</p>`) +
    `<p class="desc">必须装有${DATA.furnaceKinds[fk]}，丹阶不能高于使用中的${DATA.furnaceKinds[fk]}；「全部」= 用现有药材最多炼 ${CFG.alchemy.MAX_BATCH} 枚。每枚单独判定成功率，失败的药材不退。</p></div>`;
  return h;
};

/* 洞府 · 炼器室：按 一阶~十阶 分页，每阶里有 炼丹炉、炼器炉、装备、空间石（必须装有炼器炉） */
G.caveViews.forge = function () {
  const s = this.s, j = s.forgeJob, qi = s.furnaceUse.qi, has = qi >= 0, full = j && s.forgeQueue.length >= CFG.furnace.QUEUE, g = this.forgeTier || 0;
  const xian = DATA.FURNACE_KINDS.some(k => (k === "xdan" || k === "xqi") && (s.blueprints[k].length || s.furnaces[k].length));   // 有仙炉图纸 / 仙炉才显示炼器仙师、炼器仙炉
  let h = this.craftsmanCard("qi") + this.furnaceCard("qi") + (xian ? this.craftsmanCard("xqi") + this.furnaceCard("xqi") : "");
  let fAcc = j ? Math.max(0, j.end - Date.now()) : 0;   // 排到队列第几个为止的总时间（毫秒）
  if (j) h += `<div class="card"><h3>炼制中<small>${this.jobName(j)}</small></h3>
    <div class="line"><div class="pg">${this.pgFill(Math.max(0, j.end - Date.now()), this.forgePer(j.kind, j.g))}<span>剩余 ${U.cd(Math.max(0, j.end - Date.now()) / 1000 + 59)}</span></div><button class="sm" onclick="G.stopForge()">停止</button></div>` +
    s.forgeQueue.map((q, i) => { const ms = this.forgePer(q.kind, q.g); fAcc += ms;
      return `<div class="line"><div>队列 ${i + 1}：${this.jobName(q)}<small>需 ${U.dur(ms / 1000)} · 约 ${U.cd(fAcc / 1000 + 59)} 后完成</small></div>
      <button class="sm" onclick="G.cancelForgeQ(${i})">取消</button></div>`; }).join("") +
    `<p class="desc">队列 ${s.forgeQueue.length} / ${CFG.furnace.QUEUE}，炼好放进背包，自动开始下一个。</p></div>`;
  const btn = (ok, call) => `<button class="sm" onclick="${call}" ${!has || full || !ok ? "disabled" : ""}>${j ? "排队" : "炼制"}</button>`;
  let rows = "";
  const rate = this.ratePct(this.craftRate("qi", g));
  // 炉子（需在背包学会图纸）
  for (const k of DATA.FURNACE_KINDS) if (s.blueprints[k].includes(g)) {
    const mats = DATA.furnaceMats(k, g);
    rows += `<div class="line"><div>${DATA.li(DATA.furnaceIcon(k))}${DATA.furnaceName(k, g)}<span class="tag">-${DATA.furnaceBonus(k, g)}%</span>
      <small>${this.matsText(mats)} · ${U.dur(this.forgePer(k, g) / 1000)} · 成功率 ${this.ratePct(this.craftRate(this.forgeCraft(k), g))}</small></div>${btn(this.hasMats(mats), `G.craftFurnace('${k}',${g})`)}</div>`;
  }
  // 装备（门派炼器室学会）
  const tierOK = qi >= Math.min(g, DATA.DAN_JIE_N - 1);   // 十阶炼器炉可以炼十一、十二阶
  for (const sl of DATA.forgeSlots) if (s.forgeKnown.includes(this.forgeKey("eq", g, sl))) {
    const mats = DATA.forgeEqMats(g);
    if (sl === "fabao") {   // 法宝：7 种形状，点「选择」挑属性和形状
      const prevOK = this.fabaoAnyBase(g), yn = ((CFG.forge.YAOSHI || {}).fabao || [])[g] || 0;
      rows += `<div class="line"><div>${DATA.eqTierIco(DATA.iconImg("fbs0_0"), g)}${DATA.JIE[g]}法宝<span class="tag">${DATA.fabaoTypes.length} 种</span>
        <small>${g ? `<span class="${prevOK ? "" : "q5"}">${DATA.JIE[g - 1]}同形状同属性法宝 ×1</span>、` : ""}${this.matsText(mats)}${yn ? `、同属性${DATA.smName("ys")} ×${U.fmt(yn)}` : ""} · ${U.dur(this.forgePer("eq", g) / 1000)} · 成功率 ${rate}</small></div>
        <button class="sm" onclick="G.openFabaoPick(${g})" ${!has || full || !tierOK || !prevOK || !this.hasMats(mats) ? "disabled" : ""}>选择</button></div>`;
      continue;
    }
    const prevOK = g === 0 || this.prevEquipIndex(sl, g) >= 0, esm = this.jobSm({ kind: "eq", g, slot: sl });
    rows += `<div class="line"><div>${DATA.eqTierIco(DATA.iconImg("eq_" + sl), g)}${DATA.forgeEqName(sl, g)}<span class="tag">${DATA.slots[sl]}</span>
      <small>${g ? `<span class="${prevOK ? "" : "q5"}">${DATA.forgeEqName(sl, g - 1)} ×1</span>、` : ""}${this.matsText(mats)}${esm.length ? "、" + this.smText(esm) : ""} · ${U.dur(this.forgePer("eq", g) / 1000)} · 成功率 ${rate}</small></div>
      ${btn(tierOK && prevOK && this.hasMats(mats) && this.smHave(esm), `G.craftFurnace('eq',${g},'${sl}')`)}</div>`;
  }
  // 戒指（试炼塔图纸学会，二阶起）
  if (g > 0) {
    const mats = DATA.ringMats(g);
    DATA.ringNames.forEach((n, r) => {
      if (!this.ringKnown(r, g)) return;
      const prevOK = this.prevEquipIndex("ring", g, r) >= 0, rsm = this.jobSm({ kind: "ring", g, r });
      rows += `<div class="line"><div>${DATA.li(DATA.iconImg("eq_ring"))}${DATA.ringName(r, g)}<span class="tag">戒指</span>
        <small><span class="${prevOK ? "" : "q5"}">${DATA.ringName(r, g - 1)} ×1</span>、${this.matsText(mats)}${rsm.length ? "、" + this.smText(rsm) : ""} · ${U.dur(this.forgePer("ring", g) / 1000)} · 成功率 ${rate}</small></div>
        ${btn(tierOK && prevOK && this.hasMats(mats) && this.smHave(rsm), `G.craftFurnace('ring',${g},${r})`)}</div>`;
    });
  }
  // 空间石
  if (s.forgeKnown.includes(this.forgeKey("ss", g))) {
    const mats = DATA.stoneMats(g), sm = this.jobSm({ kind: "ss", g });
    rows += `<div class="line"><div>${DATA.li(DATA.iconImg("ss"))}${DATA.stoneName(g)}<span class="tag">储物格+1</span>
      <small>${this.matsText(mats)}${sm.length ? "、" + this.smText(sm) : ""} · ${U.dur(this.forgePer("ss", g) / 1000)} · 成功率 ${rate} · 已用 ${CFG.forge.stone.MAX_USE - this.stoneLeft(g)}/${CFG.forge.stone.MAX_USE}</small></div>
      ${btn(tierOK && this.hasMats(mats) && this.smHave(sm), `G.craftFurnace('ss',${g})`)}</div>`;
  }
  h += `<div class="card"><h3>炼器<small>${has ? `炼器炉 ${DATA.JIE[qi]} · 装备、空间石可炼一阶~${DATA.JIE[qi]}` : "需要炼器炉"}</small></h3>
    <div class="room-grid five">${DATA.JIE.map((n, i) => `<button class="${g === i ? "active" : ""}" onclick="G.setForgeTier(${i})">${n}</button>`).join("")}</div>` +
    (rows || `<p class="desc">${DATA.JIE[g]}还没有可炼制的东西：炉子图纸在门派宝库兑换，装备图谱、空间石在门派炼器室学习。</p>`) +
    `<p class="desc">二阶起的装备、法宝、戒指要用一件上一阶同部位（同种）的 + 三种矿石，升阶后属性颜色不变、数值变大；阶不能高于使用中的炼器炉。炼制失败只扣矿石，上一阶装备退回。</p></div>`;
  // 灵珠（门派炼器室学会图纸）
  const LZ = CFG.lingzhu, lzMats = this.lzMats();
  const lzRows = LZ.NAMES.map((n, ft) => !s.forgeKnown.includes(this.forgeKey("lz", 0, ft)) ? "" : `<div class="line"><div>${DATA.li(DATA.smIcon("lz", ft), "lz-glow")}${DATA.smName("lz", ft)}<span class="tag">聚灵+${U.fmt(LZ.BASE)}</span>
    <small>${this.matsText(lzMats)}、<span class="${this.smCount("lj", ft) >= LZ.JING ? "" : "q5"}">${DATA.li(DATA.smIcon("lj", ft))}${DATA.smName("lj", ft)} ${U.fmt(this.smCount("lj", ft))}/${LZ.JING}</span></small></div>
    <button class="sm" onclick="G.craftLz(${ft})" ${this.hasMats(lzMats) && this.smCount("lj", ft) >= LZ.JING ? "" : "disabled"}>炼制</button></div>`).join("");
  if (lzRows) h += `<div class="card"><h3>灵珠</h3>${lzRows}</div>`;
  return h;
};

/* 门派 · 炼器室：学习装备图谱、空间石（sect.js 调用） */
G.sectForgeView = function () {
  const s = this.s, star = this.sectInfo().star, g = this.forgeLibTier || 0, st = s.forgeStudy, lock = g >= star;
  let h = "";
  h += this.lqCard("forge");   // v173 学习队列
  const line = (kind, sl, name, tag, desc) => {
    const key = this.forgeKey(kind, g, sl), has = s.forgeKnown.includes(key), C = kind === "eq" ? CFG.forge.equip : CFG.forge.stone, c = C.learnCost[g];
    const img = kind === "ss" ? DATA.iconImg("ss") : DATA.iconImg(sl === "fabao" ? "fbs0_0" : "eq_" + sl);
    return [has, `<div class="line"><div>${kind === "eq" ? DATA.eqTierIco(img, g) : DATA.li(img)}${name}<span class="tag">${tag}</span><small>${desc}<br>${U.fmt(c)} 贡献 · 学习 ${U.dur(C.learnTime[g] * 60)}</small></div>
      ${has || lock ? `<button class="sm" disabled>${has ? "已学会" : `${g + 1}星宗门可学习`}</button>` : this.lqBtn("forge", key, `G.learnForge('${kind}',${g}${sl ? `,'${sl}'` : ""})`, s.contrib < c)}</div>`];
  };
  h += `<div class="room-grid five">${DATA.JIE.slice(0, DATA.DAN_JIE_N).map((n, i) => `<button class="${g === i ? "active" : ""}" onclick="G.setForgeLibTier(${i})">${n}</button>`).join("")}</div>`;
  const cards = [{ head: `<h3>${DATA.nmPick(CFG.names.sectHall, "forge", "炼器室")} · 图谱</h3>`, rows:
    DATA.forgeSlots.map(sl => line("eq", sl, DATA.forgeEqName(sl, g), DATA.slots[sl],
      (sl === "fabao" ? (g ? `升阶图谱：把${DATA.JIE[g - 1]}法宝升为${DATA.JIE[g]}（${DATA.fabaoTypes.length} 种通用，颜色不变）` : `炼制图谱：用耀石炼成一阶法宝（${DATA.fabaoTypes.map(t => t.name).join(" ")}，属性自选）`) : `主属性 ${CFG.forge.attr.main[sl].map(k => DATA.attrNames[k]).join("、")} + 1~5 条附加属性`) + (g ? ` · 需上一阶${DATA.slots[sl]}` : ""))).concat([
    line("ss", null, DATA.stoneName(g), DATA.SS, `使用一个储物格 +1，每阶最多 ${CFG.forge.stone.MAX_USE} 个；炼制要空间晶核（秘境掉落）`)]) }];
  // 灵珠图纸：不分阶，每个星级都能学
  const LZ = CFG.lingzhu, lzc = LZ.LEARN_COST;
  cards.push({ head: `<h3>灵珠图纸</h3>`, rows: LZ.NAMES.map((n, ft) => { const has = s.forgeKnown.includes(this.forgeKey("lz", 0, ft));
    return [has, `<div class="line"><div>${DATA.li(DATA.smIcon("lz", ft), "lz-glow")}${DATA.smName("lz", ft)}<small>${this.matsText(this.lzMats())}、${DATA.smName("lj", ft)} ×${LZ.JING}<br>${U.fmt(lzc)} 贡献 · 学习 ${U.dur(LZ.LEARN_TIME * 60)}</small></div>
      ${has ? `<button class="sm" disabled>已学会</button>` : this.lqBtn("forge", this.forgeKey("lz", 0, ft), `G.learnForge('lz',0,${ft})`, s.contrib < lzc)}</div>`]; }) });
  h += U.doneCards(cards);
  return h;
};

/* 门派 · 炼丹房：学习丹方（sect.js 调用） */
G.sectAlchemyView = function () {
  const s = this.s, star = this.sectInfo().star, tier = this.danLibTier || 0, st = s.danStudy;
  let h = "";
  h += this.lqCard("dan");   // v173 学习队列
  h += this.danCatBar("danLibCat");
  const cat = this.danLibCat || 0, catName = (CFG.alchemy.CATS || [])[cat] || "", types = Object.keys(DATA.recipes).filter(t => DATA.danCat(t) === cat && DATA.recipeHas(t, tier));
  h += `<div class="room-grid five">${DATA.JIE.slice(0, DATA.DAN_JIE_N).map((n, g) => `<button class="${tier === g ? "active" : ""}" onclick="G.setDanLibTier(${g})">${n}</button>`).join("")}</div>
    <div class="card"><h3>${DATA.nmPick(CFG.names.sectHall, "alchemy", "炼丹房")} · ${catName}丹方</h3>` +
    U.doneLast(types.map(t => {
      const key = t + "|" + tier, has = s.recipes.includes(key), c = DATA.danLearnCost(t, tier), need = DATA.danStar(t, tier), lock = need > star;
      return [has, `<div class="line"><div>${DATA.danImg(DATA.danIcon(t), DATA.danCls(t, tier), "li")}《${DATA.danName(t, tier)}》<span class="tag">${DATA.recipeEffect(t, tier)}</span>
        <small>${this.matsText(DATA.danRecipe(t, tier))}<br>${U.fmt(c)} 贡献 · 学习 ${U.dur(DATA.danLearnTime(t, tier) / 1000)}</small></div>
        ${has || lock ? `<button class="sm" disabled>${has ? "已学会" : `${need}星宗门可学习`}</button>` : this.lqBtn("dan", key, `G.learnRecipe('${t}',${tier})`, s.contrib < c)}</div>`];
    })) + `</div>`;
  return h;
};
