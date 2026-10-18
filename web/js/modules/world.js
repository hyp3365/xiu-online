/* =====================================================================
 * 模块：世界（六界：凡界 仙界 魔界 冥界 神界 天外天，目前只开放凡界）
 * 凡界内：9 张地图（练气 → 渡劫），每张分 东 西 南 北 四个区域；坊市、设置
 * ---------------------------------------------------------------------
 * 每个区域的 普通怪 / 精英怪 / 首领 属性在 js/config/ 数值文件 的 config/mobs.js 单独设置。
 * 历练：和自动探索一样走 100 步，但只走一次；走完且没战败 = 通过，解锁该区域的自动探索。
 * 自动探索：每次 TIME 步，每步 STEP_SEC 秒（config/explore.js）；固定遇到 10 个普通怪、3 个精英怪、灵药 5~10 次、矿石 5~10 次，
 *   最后一步遇到首领，其余无事发生（顺序随机）。怪物掉 灵石、药材、矿石（不掉丹药、装备）。
 *   历练、自动探索期间都不能修炼。
 * 战斗：速度高者先手，判闪避、暴击；法术栏法术轮流施放（耗法力），不足时普通攻击；战败遗失部分灵石。
 *   法术 / 法宝伤害 = 威力 − (对方防御 × RES_RATE + 对方该系抗性 × RES_EL_RATE)；普通攻击只算 防御 × DEF_RATE（v235）。
 *   怪物也有法力、六系抗性、法术和法宝（见 config/mobs.js 的 mobs.magic）。
 *   一次探索中获得的东西先记下，走完后一起放进背包；
 *   生命够（≥ 三成）就继续下一次，不够就原地休养到满血再自动继续（v186）；探索时不能修炼；离线也继续。
 *   探索信息栏显示每一步发生的事，每秒刷新。
 * 秘境（config/mijing.js）：历练探索时有几率发现；每处每天进一次，先历练通过才能自动探索；探索中 x.mj = 秘境序号、x.queue = 一键探索还没走的秘境。
 * 灵地（config/lingdi.js）：和秘境共用同一套（mjXxx 函数多一个参数 k = "ld"）；探索中 x.mk = "ld"、x.mj = 灵地序号；存档 s.ld。
 * 数值全部在 js/config/ 下的数值文件 的 monster / explore / mijing 部分。
 * ===================================================================== */
G.module({
  id: "world",
  tab: "world",

  /* explore：历练 / 自动探索中
   *   { map 地图序号, reg 区域序号(0东 1西 2南 3北), once 是否历练, start 本次开始时间, step 已走步数, count 已完成次数,
   *     loot 本次收获 { stone, mats: { "herb|名字": {kind,name,g,n} } }（秘境另有 hx、sm，自定义物品 cu）,
   *     ev 本次事件列表（最新在前）, last 上一次结算文字 } */
  // trainedR：已历练通过的区域（地图序号 × 4 + 区域序号）
  // mj：秘境 { found 已发现, trained 已历练通过, day 日期, used { 秘境序号: 今天已进次数 } }；ld：灵地，格式同 mj
  defaults: () => ({ explore: null, trainedR: [], lastRun: null, mj: { found: [], trained: [], day: "", used: {} }, ld: { found: [], trained: [], day: "", used: {} } }),

  // 每 10 秒（以及在线时每秒）推进探索
  tick() { this.advanceExplore(); },

  api: {
    setWorldTab(t) { this.worldTab = t; this.render(); },

    setHall(h) { this.hallSel = h; this.render(); },
    // 一张地图的东西南北四域（历练 / 探索 / 出窍）
    regionsCard(sel) {
      const s = this.s, map = DATA.maps[sel], lock = !this.realmOK(DATA.mapReq(sel)), unl = this.mapUnlocked(sel);
      return `<div class="card"><h3>${map.name}</h3>` +
          DATA.regionDirs.map((d, r) => {
            const R = DATA.region(sel, r), ok = this.isTrained(sel, r), x = s.explore && s.explore.map === sel && (s.explore.reg || 0) === r ? s.explore : null;
            return `<div class="line"><div>${d}域<small>首领 ${DATA.regionBoss(sel, r)} · ${ok ? "已通过历练" : "未历练"}</small></div>
              ${lock ? `<button class="sm" disabled>需${DATA.realmLabel(DATA.mapReq(sel))}</button>` : !unl || !this.regionOpen(sel, r) ? `<button class="sm" disabled>未开启</button>` : `<div><button class="sm ${x && x.once ? "on" : ""}" onclick="G.toggleExplore(${sel},${r},true)" ${s.explore && s.explore.cq ? "disabled" : ""}>${x && x.once ? "停止" : "历练"}</button>
              <button class="sm ${x && !x.once && !x.cq ? "on" : ""}" onclick="G.toggleExplore(${sel},${r})" ${ok && !(s.explore && s.explore.cq) ? "" : "disabled"}>${x && !x.once && !x.cq ? "停止" : "探索"}</button>
              <button class="sm ${x && x.cq ? "on" : ""}" onclick="G.openChuqiao(${sel},${r})" ${x && x.cq || ok && s.cqLearn && !(s.explore && s.explore.cq) ? "" : "disabled"}>${x && x.cq ? "停止" : "出窍"}</button></div>`}</div>`;
          }).join("") + (map.w === "fan" ? this.kuangLine(sel) : "") + `</div>`;
    },
    /* ---------- 凡界灵矿（config/explore.js 的 KUANG）：不用历练，不遇怪，只挖灵石；探索中 x.kuang = 1、x.reg = -1 ---------- */
    kuangName(a) { return (CFG.explore.KUANG.NAME || "{map}灵矿").replace("{map}", DATA.maps[a].name); },
    kuangLine(a) {
      const s = this.s, K = CFG.explore.KUANG, x = s.explore && s.explore.kuang && s.explore.map === a ? s.explore : null, cq = s.explore && s.explore.cq;
      return `<div class="line"><div>${this.kuangName(a)}<small>${K.DESC}</small></div>
        ${!this.realmOK(DATA.mapReq(a)) ? `<button class="sm" disabled>需${DATA.realmLabel(DATA.mapReq(a))}</button>` : !this.mapOpen(a) ? `<button class="sm" disabled>未开启</button>` : `<div><button class="sm ${x && !x.cq ? "on" : ""}" onclick="G.toggleKuang(${a})" ${cq ? "disabled" : ""}>${x && !x.cq ? "停止" : "探索"}</button>
        <button class="sm ${x && x.cq ? "on" : ""}" onclick="G.openChuqiao(${a},-1)" ${x && x.cq || s.cqLearn && !cq ? "" : "disabled"}>${x && x.cq ? "停止" : "出窍"}</button></div>`}</div>`;
    },
    kuangPlan() { return "k".repeat(CFG.explore.KUANG.TIME); },
    // 每步灵石 = 当前地图北域一次探索平均灵石 ÷ TIME × 随机(0.5 ~ 1.5)（随机取整）
    kuangStone(a) {
      const E = CFG.drop, X = CFG.explore, L = DATA.region(a, DATA.regionCount - 1).L, per = this.runStonePer(DATA.maps[a].w || "fan", L);
      const run = per * 1.75 * (X.MONSTERS + (X.ELITES || 0) * E.ELITE_STONE + X.BOSS * E.BOSS_STONE) * E.STONE_RATE * DATA.mapStone(a);
      return Math.floor(run / X.KUANG.TIME * (0.5 + Math.random()) + Math.random());
    },
    toggleKuang(a) {
      const s = this.s;
      if (s.explore && s.explore.kuang && !s.explore.cq && s.explore.map === a) { this.stopExplore("停止挖矿"); return this.after(); }
      if (this.cqBusy()) return;
      if (!this.mapOpen(a)) return;
      if (s.explore) this.stopExplore("更换");
      s.explore = { map: a, reg: -1, kuang: 1, once: false, start: this.now(), step: 0, count: 0, loot: this.newLoot(), ev: [], last: "", plan: this.kuangPlan(), ms: this.exploreMs() };
      s.lastRun = null;
      this.exploreOpen = true;
      this.log(`开始在${this.kuangName(a)}挖矿（期间无法修炼）。`, "sys");
      this.after();
    },
    setWorld(id) { if (this.worldId !== id) { this.mapSel = undefined; this.hallSel = null; } this.worldId = id; this.render(); },
    // v45：这一界开放没有（config/worldmaps.js 的 open）
    worldOpen(id) {
      if (id === "fan") return true;
      const W = (CFG.worldMaps || {})[id]; if (!W || !(DATA.worldMapIdx[id] || []).length) return false;
      const o = W.open || {};
      if (o.realm !== undefined && !this.realmOK(o.realm)) return false;
      if (o.map) { const a = (DATA.worldMapIdx[o.map[0]] || [])[o.map[1] - 1]; if (a === undefined || !this.isTrained(a, 3)) return false; }
      return true;
    },
    mapOpen(a) { return this.worldOpen(DATA.maps[a].w || "fan") && this.realmOK(DATA.mapReq(a)) && this.mapUnlocked(a); },
    // v52：同一界上一张地图（按境界从低到高）北域通关后才开启下一张
    mapPrev(a) {
      const idx = (DATA.worldMapIdx[DATA.maps[a].w || "fan"] || []).slice().sort((x, y) => DATA.mapReq(x) - DATA.mapReq(y) || x - y), i = idx.indexOf(a);
      return i > 0 ? idx[i - 1] : undefined;
    },
    mapUnlocked(a) {
      const p = this.mapPrev(a);
      return p === undefined || this.isTrained(p, DATA.regionCount - 1) || DATA.regionDirs.some((d, r) => this.isTrained(a, r));
    },
    // v52：东域通关后开启西域，依次类推
    regionOpen(a, r) { return this.mapOpen(a) && (r === 0 || this.isTrained(a, r - 1) || this.isTrained(a, r)); },

    regionKey(a, r) { return a * DATA.regionCount + r; },
    isTrained(a, r) { return this.s.trainedR.includes(this.regionKey(a, r)); },

    // 生成怪物：a 地图、r 区域、kind = normal 普通 / elite 精英 / boss 首领（属性见 js/config/ 数值文件 monster.regions）
    makeMob(a, r, kind) {
      const R = DATA.region(a, r), b = DATA.mobMeet(R, kind), map = DATA.maps[a];   // v168 每次遇到随机层 / 功法
      const v = (x, k) => x * DATA.mobRnd(k);   // × 随机浮动
      const name = kind === "boss" ? DATA.regionBoss(a, r) : (kind === "elite" ? "精英·" : "") + U.pick(map.monsters);
      return this.addMagic({ name, Lm: R.L, kind, boss: kind === "boss", elite: kind === "elite",
        hp: v(b.hp, "hp"), atk: v(b.atk, "atk"), def: v(b.def, "def"), speed: v(b.speed, "speed"), hit: v(b.hit, "hit"), dodge: v(b.dodge, "dodge"), mana: v(b.mana, "mana"), res: b.res, manaBr: b.manaBr, L: b.L, crit: b.crit }, kind);
    },

    // 给怪物加 属性 / 六系抗性 / 法术 / 法宝（config/mobs.js 的 mobs.magic）
    addMagic(m, kind, b = {}) {
      const M = (CFG.mobs.magic || {})[kind] || {}, O = (CFG.mobs.magic || {}).OWN_RES || 1;
      m.el = b.el || U.pick(DATA.elements).id;
      m.mana = m.maxMana = b.mana !== undefined ? b.mana : m.mana || 0;   // 法力 = 修为突破 + 肉身突破的法力 × 倍率（同其他属性）
      const rv = typeof m.res === "number" ? m.res : 0;
      m.res = {};
      for (const e of DATA.elements) m.res[e.id] = b.res && b.res[e.id] !== undefined ? b.res[e.id] : rv * DATA.mobRnd("res") * (e.id === m.el ? O : 1);   // v227 每系单独随机；每系抗性 = 怪物抗性（修为 + 肉身 + 真诀）× 倍率，本属性再 × OWN_RES
      m.spell = M.spell; m.fabao = M.fabao;
      return m;
    },

    // 通用战斗：速度高者先手，判闪避、暴击。返回 { win, lose, rounds, why, log }，并更新玩家生命、法力
    //   log：完整战斗过程（点「详情」查看），格式见 battleDetail
    //   opt.test（v158 实力测试）：v244 起双方照常扣生命、法力（只在测试画面里），一方倒下或打满 TEST_ROUNDS 回合结束；结束后人物生命 / 法力还原成测试前
    //   v245 进入测试时生命、法力按满的算（不管测试前多少），退出后还原成测试前的数，测试不影响原本的生命、法力
    battle(m, opt = {}) {
      const st = this.stats(), s = this.s, TEST = !!opt.test;
      const tHp = s.hp, tMp = s.mana; if (TEST) { s.hp = st.hp; s.mana = st.mana; }   // v245 实力测试：进入时生命、法力回满，结束后还原成测试前的数
      const spells = s.spellSlots.slice(0, this.slotCount()).map(id => DATA.spellInfo(id, s.gongfa[id])).filter(Boolean);
      let si = 0, act = null;   // act：这一下出手的方式 { k: 0 普通攻击 / 1 法术 / 2 法宝, sp 法术名序号, f: 0 命中 / 1 被闪避 / 2 暴击 }
      const BT = CFG.battle, myL = s.mortal ? 0 : s.L, MIN = A => DATA.minDmg(A === st ? myL : (A.L === undefined ? myL : A.L)), rnd = () => BT.RAND_MIN + Math.random() * (BT.RAND_MAX - BT.RAND_MIN);
      // 某系抗性 = 防御 × RES_RATE + 该系抗性（config/battle.js）
      const RR = BT.RES_RATE === undefined ? BT.DEF_RATE : BT.RES_RATE, ER = BT.RES_EL_RATE === undefined ? 1 : BT.RES_EL_RATE, resOf = (D, el) => D.def * RR + ((D.res || {})[el] || 0) * ER;   // v235 法术 / 法宝减免 = 防御 × RES_RATE(0.9) + 该系抗性（抗性不再 × DEF_RATE）
      const roll = (A, D, raw, k, sp) => {
        act = { k, sp, f: 0 };
        if (Math.random() * 100 < DATA.dodgeChance(A.hit, D.dodge, k)) { act.f = 1; return 0; } // 闪避（看命中与闪避之比；v220 法术 / 法宝另加命中率）
        let d = raw * rnd();
        if (Math.random() * 100 < Math.min(DATA.CRIT_CAP, A.crit)) { d *= BT.CRIT_MULT; act.f = 2; } // 暴击
        return d;
      };
      const hit = (A, D) => roll(A, D, Math.max(MIN(A), A.atk - D.def * BT.DEF_RATE), 0);
      // v57：鼎 → 对方速度 / 命中 / 闪避降低（m.deb，剩 left 回合）；印 → 对方眩晕（m.stun 回合）；盾 → 护盾（shield，打光为止）
      const mE = () => m.deb ? Object.assign({}, m, { speed: m.speed * (1 - m.deb.speed / 100), hit: m.hit * (1 - m.deb.hit / 100), dodge: m.dodge * (1 - m.deb.dodge / 100) }) : m;
      let shield = null;
      // v25：炼制法宝也能祭出（金木水火土雷属性伤害，消耗法力）
      const fabaos = s.fabao.slice(0, this.slotCount()).filter(e => e && e.attrs).map(e => DATA.fabaoInfo(e));
      // 玩家出手：法术、法宝按顺序轮流（法术在前），法力不足的跳过，都放不出就普通攻击；战斗设置（battleset.js 的 s.bset）可改
      const fbSlots = s.fabao.slice(0, this.slotCount()).map((e, i) => e && e.attrs ? i : -1).filter(i => i >= 0);
      const acts = [...spells.map((sp, i) => ({ k: 1, sp, key: "sp:" + sp.id })), ...fabaos.map((fb, i) => ({ k: 2, fb, key: "fb:" + fbSlots[i] }))];
      const spNames = [...spells.map(sp => sp.name), ...fabaos.map(fb => fb.name)];
      // 法宝伤害：攻击 × 伤害%，按「防御×RES_RATE + 该系抗性 − 无视抗性」减免；再加附加伤害 = 主伤害 × %
      const fabaoDmg = fb => {
        let d = Math.max(MIN(st), fb.atk * fb.pct / 100 - Math.max(0, resOf(m, fb.el) - fb.ign));
        let ex = 0; for (const x of fb.extra) ex += d * x.pct / 100;   // 附加伤害：主伤害 × %
        return d + ex + (fb.addDmg || 0);   // v152 强化附加伤害（固定数字）
      };
      const BS = this.bsetGet(), onlyAtk = !!opt.foe && (BS.foe || {})[opt.foe] === "atk", off = BS.off || [],   // v241 按对手类型：只能普通攻击（优先于回合设置）
       keepMp = 0, rKeys = BS.r || [];
      let rDone = 0;
      // 出一招：a = acts[j]；res = true 可以动用保留的法力；放不出返回 null
      const usedN = {};   // v152 这场战斗每招已用几次
      let res2 = false;
      const cast = (j, res) => {
        const a = acts[j]; if (!a) return null;
        const cost = a.k === 1 ? a.sp.mana : a.fb.mana;
        if (a.k === 2 && a.fb.shield && (shield || !res2)) return null;   // 护盾还在：盾不用再祭；v165 盾只在出手前免费祭（res2），不占出手
        if (s.mana < cost || (!res && s.mana - cost < keepMp)) return null;
        if ((usedN[j] || 0) >= ((a.k === 1 ? a.sp.uses : a.fb.uses) || 1)) return null;   // v152 每场战斗使用次数用完
        usedN[j] = (usedN[j] || 0) + 1;
        s.mana -= cost;
        if (a.k === 1) { const sp = a.sp, d = roll(st, mE(), Math.max(MIN(st), sp.atk * sp.pct / 100 * sp.mul * this.lingenSpell(sp.el.id) + (sp.jyDmg || 0) - resOf(m, sp.el.id)), 1, j);
          if (!opt.test) { const xd = CFG.gongfa.XD_GAIN === undefined ? 1 : CFG.gongfa.XD_GAIN; if (xd > 0) { const X = this.s.spXd = this.s.spXd || {}; X[sp.el.id] = (X[sp.el.id] || 0) + xd; act.x = (act.x || 0) | 256; } }   // v239 法术心得
          return d; }
        const fb = a.fb;
        if (fb.shield) { shield = Object.assign({ el: fb.el }, fb.shield); act = { k: 3, sp: j, f: 0 }; return 0; }
        let d = roll(fb.hit || fb.critAdd ? Object.assign({}, st, { hit: st.hit + (fb.hit || 0), crit: st.crit + (fb.critAdd || 0) }) : st, mE(), fabaoDmg(fb), 2, j);   // 刀 / 锤专属：本次攻击额外命中、暴击
        if (act.f === 2 && fb.crit) d *= fb.crit / 100;   // 锤：暴击伤害 %
        if (act.f !== 1) {
          if (fb.ding) { m.deb = { speed: fb.ding.speed, hit: fb.ding.hit, dodge: fb.ding.dodge, left: fb.ding.rounds }; act.x = 2; }
          if (fb.yin && Math.random() * 100 < fb.yin.chance) { m.stun = Math.max(m.stun || 0, fb.yin.rounds); act.x = (act.x || 0) | 1; }
        }
        return d;
      };
      const est = a => a.k === 1 ? Math.max(MIN(st), a.sp.atk * a.sp.pct / 100 * a.sp.mul * this.lingenSpell(a.sp.el.id) + (a.sp.jyDmg || 0) - resOf(m, a.sp.el.id)) : a.fb.shield ? -1 : fabaoDmg(a.fb);
      const costOf = a => a.k === 1 ? a.sp.mana : a.fb.mana;
      const jOf = key => acts.findIndex(a => a.key === key);
      const useJ = acts.map((a, j) => j).filter(j => !off.includes(acts[j].key));
      const ptr = {};   // 各组轮流到第几个
      const rot = (js, g) => {   // 在 js 里轮流，放出一招返回伤害，都放不出返回 null
        let d; const p = ptr[g] || 0;
        for (let k = 0; k < js.length; k++) { const i = (p + k) % js.length; if ((d = cast(js[i])) !== null) { ptr[g] = i + 1; return d; } }
        return null;
      };
      const seq = js => { let d; for (const j of js) if ((d = cast(j)) !== null) return d; return null; };
      const spJ = useJ.filter(j => acts[j].k === 1), fbJ = useJ.filter(j => acts[j].k === 2);
      const ordIdx = key => { const i = (BS.order || []).indexOf(key); return i < 0 ? 999 + jOf(key) : i; };
      const myHit = () => {
        let d;
        if (meSeal || onlyAtk) return hit(st, mE());   // 被镇魂 / v241 战斗设置该类对手只普通攻击：只能普通攻击
        // 生命低于设定：先用设定的防御法宝 / 法术（可动用保留法力）
        if (BS.lowPct > 0 && BS.lowKey && php < st.hp * BS.lowPct / 100 && (d = cast(jOf(BS.lowKey), true)) !== null) return d;
        // 第一 ~ 三回合：每回合第一次出手按设置
        if (rDone !== rounds) {
          rDone = rounds;
          const rk = rKeys[rounds - 1];
          if (rk === "atk") return hit(st, mE());
          if (rk && rk !== "auto" && (d = cast(jOf(rk), true)) !== null) return d;
        }
        const md = BS.mode || "rot";
        if (md === "sp") d = rot(spJ, "s"), d = d !== null ? d : rot(fbJ, "f");
        else if (md === "fb") d = rot(fbJ, "f"), d = d !== null ? d : rot(spJ, "s");
        else if (md === "max") d = seq(useJ.filter(j => est(acts[j]) >= 0).sort((x, y) => est(acts[y]) - est(acts[x])));
        else if (md === "cheap") d = seq(useJ.filter(j => est(acts[j]) >= 0).sort((x, y) => costOf(acts[x]) - costOf(acts[y])));
        else if (md === "atk") d = null;   // v242 剩余回合只普通攻击
        else if (md === "list") d = seq(useJ.slice().sort((x, y) => ordIdx(acts[x].key) - ordIdx(acts[y].key)));
        else d = rot(useJ, "a");
        return d !== null ? d : hit(st, mE());
      };
      let php = s.hp, mhp = m.hp, rounds = 0, dealt = 0, taken = 0;
      const W = CFG.wudao, MB = this.mifaBonus(), LX = W.LIANXING || {}, lxMe = MB.lianxing || 0;
      // 怪物秘法：第一次战斗时随机决定有哪几种（m.mf）
      if (!m.mf) {
        const MM = W.MOB_MIFA || {}, T = MM[m.boss ? "boss" : m.elite ? "elite" : "normal"] || {}, pool = (MM.POOL || []).slice(); m.mf = [];
        if (Math.random() * 100 < (T.CHANCE || 0)) { const N = T.N || [1, 1]; let n = N[0] + Math.floor(Math.random() * (N[1] - N[0] + 1)); while (n-- > 0 && pool.length) m.mf.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]); }
      }
      const hasM = k => m.mf.includes(k), lxMob = hasM("lianxing") ? LX.MOB || 0 : 0;
      // 战斗秘法（config/wudao.js）：御天 保命、破军 无视防御、血煞 低血增伤、镇魂 只能普攻、金蝉 免疫攻击
      const YT = W.YUTIAN || {}, PJ = W.POJUN || {}, XS = W.XUESHA || {}, ZH = W.ZHENHUN || {}, JC = W.JINCHAN || {};
      const P = (me) => me ? { yt: MB.yutian || 0, ytT: YT.TIMES || 0, pj: MB.pojun || 0, pjI: MB.pojunIgn || 0, xs: MB.xuesha || 0, zh: MB.zhenhun || 0, zhT: ZH.TIMES || 0, zhR: MB.zhenhunR || 3, jc: MB.jinchan || 0, jcT: JC.TIMES || 0, jcC: MB.jinchanCut || 0 }
        : { yt: hasM("yutian") ? YT.MOB || 0 : 0, ytT: YT.MOB_TIMES || 0, pj: hasM("pojun") ? PJ.MOB || 0 : 0, pjI: PJ.MOB_IGNORE || 0, xs: hasM("xuesha") ? XS.MOB || 0 : 0,
          zh: hasM("zhenhun") ? ZH.MOB || 0 : 0, zhT: ZH.TIMES || 0, zhR: ZH.MOB_ROUNDS || 3, jc: hasM("jinchan") ? JC.MOB || 0 : 0, jcT: JC.TIMES || 0, jcC: JC.MOB_CUT || 0 };
      const pMe = P(true), pMob = P(false), cnt = { me: { yt: 0, zh: 0, jc: 0 }, mob: { yt: 0, zh: 0, jc: 0 } };
      let meSeal = 0, mobSeal = 0, meJc = 0, mobJc = 0, sealR = { me: 0, mob: 0 };
      const ch = v => v > 0 && Math.random() * 100 < v;
      // 出手后的伤害修正：血煞增伤、金蝉自降、对方金蝉免疫；返回修正后的伤害
      const after = (d, p, hpNow, hpMax, myJc, tgtJc) => {
        if (!(d > 0) || act.k >= 3) return d;
        if (p.xs > 0) { const r = hpNow / hpMax; d *= 1 + p.xs / 100 * (r * 100 <= (XS.FULL_AT || 0) ? 1 : Math.max(0, 1 - r)); }
        if (myJc) d *= 1 - p.jcC / 100;
        if (tgtJc && act.f !== 1) { d = 0; act.x = (act.x || 0) | 128; }
        return d;
      };
      // v174 本场人物速度随机 95%~105%（怪物属性本身已随机，不再随机），谁快谁先出手
      const SR = BT.SPEED_RAND || [100, 100], spMe = (SR[0] + Math.random() * (SR[1] - SR[0])) / 100, spMob = 1;
      const hp0 = s.hp, mana0 = s.mana, meFirst = st.speed * spMe >= m.speed * spMob;
      // 怪物出手：先判法术，再判法宝（都按 防御×RES_RATE + 该系抗性 减免），都没有就普通攻击
      let mSp = 0, mFb = 0;
      const mCast = (k, el) => {
        const c = m[k], P = c && c.mana || [0, 1], cost = c ? (m.manaBr || 0) * P[0] * (P[1] === undefined ? 1 : P[1]) : 0;   // 耗法力 = 修为突破法力 × 比例 × 倍率
        if (!c || m.mana < cost || Math.random() * 100 >= c.chance) return -1;
        m.mana -= cost; k === "spell" ? mSp++ : mFb++;
        return roll(mE(), st, Math.max(MIN(m), m.atk * c.pct / 100 - (el ? resOf(st, el) : st.def * BT.DEF_RATE)), k === "spell" ? 1 : 2);
      };
      const mobHit = () => { let d = mCast("spell", m.el); if (d < 0) d = mCast("fabao", m.el); return d < 0 ? hit(mE(), st) : d; };   // v25：怪物法宝也是属性伤害
      // 每一下记一条：[回合, 谁(0 你 / 1 对方), 方式, 法术名序号, 结果, 伤害, 你的生命, 你的法力, 对方生命, 对方法力]
      const log = [], R = Math.round;
      //   v57 多两格：[10] 标记（1 眩晕对方 2 鼎减益 4 护盾破碎）、[11] 护盾抵挡的伤害；方式 3 = 祭起护盾（伤害格 = 护盾值）、4 = 被眩晕
      const rec = (w, d) => log.push([rounds, w, act.k, act.sp === undefined ? -1 : act.sp, act.f, R(d), R(Math.max(0, php)), R(s.mana), R(Math.max(0, mhp)), R(m.mana || 0), act.x || 0, R(act.ab || 0)]);
      // v165 出手前：护盾不在、盾还有次数、法力够 → 先免费祭起护盾（不占这次出手，只算盾的使用次数）
      const freeShield = () => {
        if (meSeal || shield || onlyAtk) return;
        for (const j of useJ) if (acts[j].k === 2 && acts[j].fb.shield) {
          res2 = true; const d = cast(j, true); res2 = false;
          if (d !== null) { rec(0, shield.hp); return; }
        }
      };
      // v165 怪物护盾：几率 = 法宝几率 × CHANCE_PCT%，每场最多 MAX 次，不占出手
      const MS = (CFG.mobs.magic || {}).SHIELD || {};
      let mShield = null, mShN = 0;
      const mobShield = () => {
        const c = m.fabao; if (!c || mobSeal || mShield || mShN >= (MS.MAX || 0)) return;
        const P = c.mana || [0, 1], cost = (m.manaBr || 0) * P[0] * (P[1] === undefined ? 1 : P[1]);
        if (m.mana < cost || Math.random() * 100 >= c.chance * (MS.CHANCE_PCT || 0) / 100) return;
        m.mana -= cost; mShN++;
        const rp = v => Array.isArray(v) ? v[0] + Math.random() * (v[1] - v[0]) : v || 0;   // v166 [最小, 最大] 随机
        mShield = { hp: m.hp * rp(MS.HP_PCT) / 100, def: m.def * rp(MS.DEF_PCT) / 100, red: MS.RED || 0 };
        act = { k: 3, f: 0 }; rec(1, mShield.hp);
      };
      const me = (lx) => {
        freeShield();
        const pj = ch(pMe.pj), def0 = m.def; if (pj) m.def = def0 * (1 - pMe.pjI / 100);   // 破军：这一下无视部分防御
        let d = myHit(); m.def = def0;
        if (lx) act.x = (act.x || 0) | 8;
        if (pj && act.k < 3 && act.f !== 1) act.x = (act.x || 0) | 32;
        d = after(d, pMe, php, st.hp, meJc, mobJc);
        if (act.k < 3 && act.f !== 1 && !(act.x & 128) && !mobSeal && cnt.me.zh < pMe.zhT && ch(pMe.zh)) { mobSeal = pMe.zhR; sealR.mob = rounds; cnt.me.zh++; act.x = (act.x || 0) | 64; }
        if (mShield && act.k < 3 && act.f !== 1 && d > 0) {   // v165 怪物护盾
          d = Math.max(MIN(st), Math.max(0, d - mShield.def * BT.DEF_RATE) * (1 - mShield.red / 100));   // v172 减盾防御后仍有保底伤害
          const ab = Math.min(mShield.hp, d); mShield.hp -= ab; d -= ab; act.ab = ab;
          if (mShield.hp <= 0) { mShield = null; act.x = (act.x || 0) | 4; }
        }
        mhp -= d; dealt += d;
        if (mhp <= 0 && php > 0 && cnt.mob.yt < pMob.ytT && ch(pMob.yt)) { dealt -= 1 - mhp; mhp = 1; cnt.mob.yt++; act.x = (act.x || 0) | 16; }   // 对方御天保命
        rec(0, d);
      };
      const him = (lx) => {
        if (m.stun > 0) { m.stun--; act = { k: 4, f: 0 }; rec(1, 0); return; }   // 被眩晕：这次不能出手
        mobShield();
        const pj = ch(pMob.pj), def0 = st.def; if (pj) st.def = def0 * (1 - pMob.pjI / 100);
        let d = mobSeal ? hit(mE(), st) : mobHit(); st.def = def0;   // 被镇魂：只能普通攻击
        if (lx) act.x = (act.x || 0) | 8;
        if (pj && act.f !== 1) act.x = (act.x || 0) | 32;
        d = after(d, pMob, mhp, m.hp, mobJc, meJc);
        if (act.f !== 1 && !(act.x & 128) && !meSeal && cnt.mob.zh < pMob.zhT && ch(pMob.zh)) { meSeal = pMob.zhR; sealR.me = rounds; cnt.mob.zh++; act.x = (act.x || 0) | 64; }
        if (shield && act.f !== 1 && d > 0) {   // 护盾：先减盾防御，再减「受到伤害减少%」，剩下先扣护盾值
          d = Math.max(MIN(m), Math.max(0, d - shield.def * BT.DEF_RATE) * (1 - shield.red / 100));   // v172 减盾防御后仍有保底伤害
          const ab = Math.min(shield.hp, d); shield.hp -= ab; d -= ab; act.ab = ab;
          if (shield.hp <= 0) { shield = null; act.x = (act.x || 0) | 4; }
        }
        php -= d; taken += d;
        if (php <= 0 && mhp > 0 && cnt.me.yt < pMe.ytT && ch(pMe.yt)) { taken -= 1 - php; php = 1; cnt.me.yt++; act.x = (act.x || 0) | 16; }   // 御天保命
        rec(1, d);
      };
      // 金蝉：每回合开始判定（方式 5 = 发动金蝉秘法）
      const jcTry = (w) => {
        const c = w ? cnt.mob : cnt.me, p = w ? pMob : pMe;
        if ((w ? mobJc : meJc) || c.jc >= p.jcT || !ch(p.jc)) return;
        c.jc++; if (w) mobJc = JC.ROUNDS || 3; else meJc = JC.ROUNDS || 3;
        act = { k: 5, f: 0 }; rec(w, 0);
      };
      while (php > 0 && mhp > 0 && rounds < (TEST ? BT.TEST_ROUNDS || 500 : BT.MAX_ROUNDS)) {
        rounds++;
        jcTry(0); jcTry(1);
        // 连星秘法：这回合有几率再出手一次（[10] 标记 8）
        const meT = () => { me(); if (mhp > 0 && php > 0 && Math.random() * 100 < lxMe) me(true); };
        const himT = () => { him(); if (act.k !== 4 && mhp > 0 && php > 0 && Math.random() * 100 < lxMob) him(true); };
        if (st.speed * spMe >= mE().speed * spMob) { meT(); if (mhp > 0) himT(); }   // 每回合按当前速度定先手（鼎会降低对方速度）
        else { himT(); if (php > 0) meT(); }
        if (m.deb && --m.deb.left <= 0) m.deb = null;
        if (meJc) meJc--; if (mobJc) mobJc--;
        if (meSeal && sealR.me !== rounds) meSeal--; else if (meSeal) sealR.me = -1;
        if (mobSeal && sealR.mob !== rounds) mobSeal--; else if (mobSeal) sealR.mob = -1;
      }
      s.hp = TEST ? tHp : Math.max(1, php);
      if (TEST) s.mana = tMp;
      // 战斗说明（显示在探索信息里）
      const why = `你出战时生命 ${U.fmt(hp0)}，共造成 ${U.fmt(dealt)} 伤害（对方剩余生命 ${U.fmt(Math.max(0, mhp))}/${U.fmt(m.hp)}），承受 ${U.fmt(taken)} 伤害；对方攻击 ${U.fmt(m.atk)} 防御 ${U.fmt(m.def)}${m.el ? `，${DATA.elById[m.el].name}属性，施法术 ${mSp} 次、法宝 ${mFb} 次` : ""}`;
      const detail = { name: m.name, el: m.el || "", a: m.a, sp: spNames, spEl: spells.map(sp => sp.el.name), first: meFirst ? 0 : 1, log, mf: m.mf.slice(),
        me: [R(hp0), R(st.hp), R(mana0), R(st.mana)], mob: [R(m.hp), R(m.hp), R(m.maxMana || 0), R(m.maxMana || 0)],
        // v181 这场战斗怪物的准确属性（战斗画面点怪物查看）
        ms: { hp: m.hp, atk: m.atk, def: m.def, speed: m.speed, hit: m.hit, dodge: m.dodge, mana: m.maxMana || 0, crit: m.crit || 0, res: Object.assign({}, m.res || {}),
          sp: m.spell ? [m.spell.chance, m.spell.pct] : null, fb: m.fabao ? [m.fabao.chance, m.fabao.pct] : null } };
      const win = mhp <= 0 && php > 0;   // 打满 MAX_ROUNDS 回合没击败对方也算失败（timeout）
      return { win, lose: !win, timeout: !win && php > 0, rounds, why, detail };
    },

    // 战斗过程每一下的文字（b = battle() 返回的 detail）
    battleRow(b, x) {
      const [r, w, k, sp, f, d, ph, pm, mh, mm, fx, ab] = x, el = b.el ? DATA.elById[b.el].name : "";
      const P = `<span class="bt-p">你</span>`, M = `<span class="bt-m">${b.name}</span>`, who = w ? M : P, tgt = w ? P : M;
      const S = t => `<span class="bt-s">${t}</span>`, D = n => `<span class="bt-d">${U.fmt(n)}</span>`;
      const pre = (fx & 8 ? `发动${S("连星秘法")}，` : "") + (fx & 32 ? `发动${S("破军秘法")}，` : "");
      const how = k === 1 ? `施放${S(w ? `${el}系法术` : `《${b.sp[sp] || "法术"}》`)}` : k === 2 ? `祭出${S(w || !b.sp[sp] ? "法宝" : `「${b.sp[sp]}」`)}`
        : k === 3 ? `祭起${S(`「${b.sp[sp] || "护盾"}」`)}` : k === 4 ? "被眩晕" : k === 5 ? `发动${S("金蝉秘法")}` : "发动普通攻击";
      let res = k === 3 ? `，护盾值 ${D(d)}` : k === 4 ? "，无法行动" : k === 5 ? `，${CFG.wudao.JINCHAN && CFG.wudao.JINCHAN.ROUNDS || 3} 回合内免疫攻击` : fx & 128 ? `，被${tgt}的金蝉秘法挡下` : f === 1 ? `，被${tgt}闪避` : `，${f === 2 ? `<span class="bt-c">暴击</span>` : ""}对${tgt}造成 ${D(d)} 点伤害`;
      if (ab) res += `（护盾抵挡 ${U.fmt(ab)}）`;
      if (fx & 4) res += `，${tgt}的护盾破碎`;
      if (fx & 2) res += `，${tgt}速度、命中、闪避降低`;
      if (fx & 1) res += `，${tgt}被眩晕`;
      if (fx & 64) res += `，${tgt}被镇魂，只能普通攻击`;
      if (fx & 16) res += `，${tgt}发动御天秘法，保留一点生命`;
      if (fx & 256 && !w) res += `，获得${(b.spEl && b.spEl[sp]) || ""}系法术心得 ${CFG.gongfa.XD_GAIN === undefined ? 1 : CFG.gongfa.XD_GAIN} 点`;   // v239
      return `<p>${who}${pre}${how}${res}。</p>`;
    },
    // 战斗总览：先手、开战数值、双方各方式伤害合计
    battleHead(b) {
      const K = ["普通攻击", "法术", "法宝", "护盾", "被眩晕", "金蝉秘法"], el = b.el ? DATA.elById[b.el].name : "";
      const sum = (w, k) => b.log.filter(x => x[1] === w && x[2] === k).reduce((t, x) => t + x[5], 0);
      const cnt = (w, k) => b.log.filter(x => x[1] === w && x[2] === k).length;
      const line = w => K.map((n, k) => cnt(w, k) ? `${n} ${cnt(w, k)} 次${k < 3 ? " " + U.fmt(sum(w, k)) : ""}` : "").filter(Boolean).join("，") || "无";
      return `<p class="bt-sum">${el ? `${b.name}为${el}属性 · ` : ""}${b.first ? `${b.name}先手` : "你先手"}${b.mf && b.mf.length ? `<br>${b.name}秘法：${b.mf.map(k => (DATA.mifaKindById[k] || {}).name || k).join("、")}` : ""}<br>开战：你 生命 ${U.fmt(b.me[0])}/${U.fmt(b.me[1])} 法力 ${U.fmt(b.me[2])}/${U.fmt(b.me[3])} · ${b.name} 生命 ${U.fmt(b.mob[0])} 法力 ${U.fmt(b.mob[2])}<br>
        你造成：${line(0)}<br>${b.name}造成：${line(1)}</p>`;
    },
    // 看详情：src = "cur" 本次探索 / "last" 上一次结果，i = 事件序号；用战斗过程画面重放，随时可跳过
    showBattle(src, i) {
      const s = this.s, hi = /^h\d+$/.test(src) ? +src.slice(1) : -1, list = hi >= 0 ? ((s.exHist || [])[hi] || {}).ev : src === "cur" ? (s.explore && s.explore.ev) : (s.lastRun && s.lastRun.ev), e = list && list[i];   // v205 "h序号" = 全部探索里的第几次
      if (!e || !e.b) return;
      this._backHist = hi >= 0;   // 从全部探索点进来：关闭回放后回到全部探索窗口
      const b = e.b, last = b.log[b.log.length - 1], win = last ? last[8] <= 0 && last[6] > 0 : false;
      this.playBattle(b, "战斗过程", win ? "胜利" : "失败", win, [], true);
    },
    // 怪物图：img/mob/地图序号_怪物序号.webp（DATA.maps[a].monsters 的序号）；北域首领 / 秘境怪等用 img/mob/m地图序号.webp
    //   「精英·X」「东域·X王」按 X 找图；试炼塔、晋升考验没有地图，按名字固定挑一张地图首领图
    battleMobImg(b) {
      let a = b.a, f;
      if (!(a >= 0 && a < DATA.maps.length)) { let h = 0; for (const ch of b.name || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0; a = h % DATA.maps.length; }
      else { const nm = String(b.name || "").replace(/^精英·/, "").replace(/^.域·(.+)王$/, "$1"), i = (DATA.maps[a].monsters || []).indexOf(nm); if (i >= 0) f = `${a}_${i}`; }
      return { src: `img/mob/${f || "m" + a}.webp?v=${DATA.IMG_V}`, alt: `img/mob/m${a}.webp?v=${DATA.IMG_V}` };
    },
    // 战斗过程画面：每 ACT_SEC 秒播放一次出手；结果已经结算好，这里只是播放
    //   现场战斗（试炼塔等）SKIP_SEC 秒后可跳过，replay（看详情）随时可跳过
    //   结果提示（log）等战斗播放完才出：logs = [[文字, 颜色], …]，不传则用 txt（胜 gold / 败 bad）
    //   opt.test（v158 实力测试）：不自动结束、随时可关闭，显示累计伤害
    // v181 点怪物：显示这场战斗怪物的准确属性（再点一次关闭）
    btMobInfo() {
      const el = document.getElementById("bt-info"), b = this._bp && this._bp.b; if (!el || !b) return;
      if (el.style.display !== "none") { el.style.display = "none"; return; }
      const m = b.ms; if (!m) { el.innerHTML = "<p>没有这场战斗的怪物属性</p>"; el.style.display = ""; return; }
      const f = U.fmt, rs = DATA.elements.map(e => `${e.name}${U.fmt(m.res[e.id] || 0)}`).join("　");
      el.innerHTML = `<b>${b.name}${b.el && DATA.elById[b.el] ? `（${DATA.elById[b.el].name}属性）` : ""}</b>
        <p>生命 ${f(m.hp)}　攻击 ${f(m.atk)}　防御 ${f(m.def)}</p><p>速度 ${f(m.speed)}　命中 ${f(m.hit)}　闪避 ${f(m.dodge)}</p>
        <p>法力 ${f(m.mana)}　暴击 ${U.num(m.crit)}%</p><p>抗性：${rs}</p>
        ${m.sp ? `<p>法术：每回合 ${m.sp[0]}% 几率，攻击×${m.sp[1]}%</p>` : ""}${m.fb ? `<p>法宝：每回合 ${m.fb[0]}% 几率，攻击×${m.fb[1]}%</p>` : ""}
        ${b.mf && b.mf.length ? `<p>秘法：${b.mf.map(k => (DATA.mifaKindById[k] || {}).name || k).join("、")}</p>` : ""}<small>点击关闭</small>`;
      el.style.display = "";
    },
    playBattle(b, title, txt, win, logs, replay, opt = {}) {
      if (this._bp && this._bp.timer) clearInterval(this._bp.timer);
      if (this._bp) this.battleDone(this._bp);
      const bp = this._bp = { b, title, txt, win, logs: logs || [[txt, win ? "gold" : "bad"]], acts: b.log.slice(), shown: 0, t0: Date.now(), done: false, replay: !!replay, test: !!opt.test, sum: [0, 0], hp: [b.me[0], b.mob[0]], mp: [b.me[2], b.mob[2]] };
      this._lockModal = true;
      const v = DATA.IMG_V, mi = this.battleMobImg(b);
      // v161 名字不放在人物 / 怪物脚下，怪物名字放标题后面（opt.tname 可改标题里显示的名字）
      this.modal(`<div class="btv" style="--bs:${CFG.battle.ANIM_SLOW || 1}">
        <div class="btv-title">${title}${opt.tname === "" ? "" : ` · ${opt.tname || b.name}`}</div>
        <div class="btv-stage" style="background-image:url(img/bt_bg.webp?v=${v})">
          <div class="btv-hp l"><div class="btv-bar"><i id="bt-hp0"></i></div><span id="bt-hpt0"></span><div class="btv-mp"><i id="bt-mp0"></i></div></div>
          <div class="btv-zhan">战</div>
          <div class="btv-hp r"><div class="btv-bar"><i id="bt-hp1"></i></div><span id="bt-hpt1"></span><div class="btv-mp"><i id="bt-mp1"></i></div></div>
          <div class="btv-u l" id="bt-u0"><div class="btv-hero"><img class="btv-body" src="img/bt_hero.webp?v=${v}" alt=""><div class="btv-arm"><img class="btv-sword" src="img/bt_sword.webp?v=${v}" alt=""><img class="btv-hand" src="img/bt_hand.webp?v=${v}" alt=""></div></div></div>
          <div class="btv-u r" id="bt-u1" onclick="G.btMobInfo()"><img src="${mi.src}" onerror="this.onerror=null;this.src='${mi.alt}'" alt=""></div>
          <div class="btv-fx" id="bt-fx"></div>
          <div class="btv-info" id="bt-info" style="display:none" onclick="G.btMobInfo()"></div>
        </div>
        ${opt.test ? `<div class="btv-sum" id="bt-sum"></div>` : ""}
        <div class="btv-log" id="bt-log">${opt.head || ""}<p class="bt-gray"><span class="bt-m">${b.name}</span>上阵${b.el ? `（${DATA.elById[b.el].name}属性）` : ""}，${b.first ? `<span class="bt-m">${b.name}</span>先手` : `<span class="bt-p">你</span>先手`}。</p></div>
        <div class="btns" id="bt-btn"></div></div>`);
      this.btHp();
      const step = () => {
        if (this._bp !== bp) return clearInterval(bp.timer);
        if (bp.shown < bp.acts.length) this.btAct(bp.acts[bp.shown++], true);
        if (bp.shown >= bp.acts.length) { clearInterval(bp.timer);
          if (bp.test) { const lg = $("#bt-log"); if (lg) { const L = bp.acts[bp.acts.length - 1] || [], ph = L[6], mh = L[8];   // v244 测试也会分出胜负
            lg.insertAdjacentHTML("beforeend", `<p class="bt-gray">${mh <= 0 && ph > 0 ? `第 ${bp.round || 0} 回合击败对手` : ph <= 0 ? `第 ${bp.round || 0} 回合落败` : `已打满 ${bp.round || 0} 回合`}。</p>`); lg.scrollTop = 1e9; } }
          else setTimeout(() => { if (this._bp === bp) this.btFinish(); }, 600); }
        this.btBtn();
      };
      this.btBtn();
      if (!bp.acts.length) return this.btFinish();
      step(); bp.timer = setInterval(step, (CFG.battle.ACT_SEC || 1) * 1000);
      bp.skipT = setTimeout(() => this.btBtn(), (CFG.battle.SKIP_SEC || 3) * 1000 + 50);
    },
    btCanSkip() { const bp = this._bp; return bp && (bp.replay || Date.now() - bp.t0 >= (CFG.battle.SKIP_SEC || 3) * 1000); },
    btBtn() {
      const bp = this._bp, el = $("#bt-btn"); if (!bp || !el) return;
      const ok = this.btCanSkip(), left = Math.ceil((CFG.battle.SKIP_SEC || 3) - (Date.now() - bp.t0) / 1000);
      const h = bp.done || bp.test ? `<button class="btv-btn" onclick="G.closeBattle()">关闭</button>`
        : `<button class="btv-btn" onclick="G.skipBattle()" ${ok ? "" : "disabled"}>${ok ? "跳过" : `${left} 秒后可跳过`}</button>`;
      if (el.innerHTML !== h) el.innerHTML = h;
    },
    btHp() {
      const bp = this._bp; if (!bp) return; const b = bp.b, mx = [b.me[1], b.mob[1]];
      for (const i of [0, 1]) { const bar = $("#bt-hp" + i), t = $("#bt-hpt" + i); if (!bar) continue;
        bar.style.width = Math.max(0, Math.min(100, bp.hp[i] / (mx[i] || 1) * 100)) + "%"; t.textContent = U.fmt(Math.max(0, bp.hp[i]));
        const mb = $("#bt-mp" + i), mm = [b.me[3], b.mob[3]][i]; if (mb) mb.style.width = (mm > 0 ? Math.max(0, Math.min(100, (bp.mp || [])[i] / mm * 100)) : 0) + "%"; }   // v244 法力蓝条
    },
    // 播放一次出手：文字 + 血条 + 动作（普通攻击冲撞、法术光球、法宝飞剑、护盾光罩）
    btAct(x, anim) {
      const bp = this._bp, b = bp.b, [r, w, k, sp, f, d, ph, pm, mh, mm, fx] = x;
      bp.hp = [ph, mh]; bp.mp = [pm, mm];
      if (bp.test) { if (k < 3 && d > 0) bp.sum[w] += d; const se = $("#bt-sum"), R0 = bp.round || 1;
        if (se) se.innerHTML = `你共造成 <b>${U.fmt(bp.sum[0])}</b>（每回合 ${U.fmt(bp.sum[0] / Math.max(1, r))}）　对方共造成 <b>${U.fmt(bp.sum[1])}</b>（每回合 ${U.fmt(bp.sum[1] / Math.max(1, r))}）`; }
      const log = $("#bt-log");
      if (log) { if (r !== bp.round) { bp.round = r; log.insertAdjacentHTML("beforeend", `<p class="bt-rd">第 ${r} 回合</p>`); }
        log.insertAdjacentHTML("beforeend", this.battleRow(b, x)); log.scrollTop = 1e9; }
      if (!anim) return;
      const fxEl = $("#bt-fx"), me = $("#bt-u" + w), tg = $("#bt-u" + (1 - w)); if (!fxEl || !me || !tg) return this.btHp();
      // v160 同一个元素只留一个动作 class（否则 CSS 里后写的动作会盖掉新动作，看起来原地不动）
      const ALL = ["btv-hit", "btv-dodge", "btv-lunge-l", "btv-pounce-r", "btv-claw-r", "btv-wave-r", "btv-mpounce", "btv-mwave", "btv-cast", "btv-hact"];
      const re = (el, c) => { ALL.forEach(x => el.classList.remove(x)); void el.offsetWidth; el.classList.add(c); };
      const SL = CFG.battle.ANIM_SLOW || 1;   // v161 动画放慢倍数
      const add = (cls, txt, side, ms) => { ms = (ms || 1200) * SL; const n = document.createElement("div"); n.className = cls + " " + (side ? "r" : "l"); if (txt) n.textContent = txt; fxEl.appendChild(n); setTimeout(() => n.remove(), ms || 1200); return n; };
      const el = b.el && !w ? "" : b.el;   // 怪物法术 / 法宝带属性色
      const name = k === 1 ? (w ? (b.el ? DATA.elById[b.el].name + "系法术" : "法术") : (b.sp[sp] || "法术")) : k === 2 ? (w || !b.sp[sp] ? "法宝" : b.sp[sp]) : k === 3 ? (b.sp[sp] || "护盾") : k === 5 ? "金蝉秘法" : "";
      if (name) add("btv-skill", name, w);
      const hit = () => {
        if (fx & 4) this.btRing(1 - w, false);   // v165 护盾破碎：光圈消失
        if (k === 3 || k === 4 || k === 5) return;
        if (fx & 128) { add("btv-pop gray", "免疫", 1 - w); return; }
        if (f === 1) { re(tg, "btv-dodge"); add("btv-pop gray", "闪避", 1 - w); return; }
        re(tg, "btv-hit"); add("btv-pop" + (f === 2 ? " crit" : ""), (f === 2 ? "暴击 " : "") + "-" + U.fmt(d), 1 - w);
        this.btHp();
      };
      // v170 人物不挥剑：普攻 / 法术 / 法宝 = 原地抖动 + 放大，放完恢复原大小；（v159）怪物普攻 = 冲过去扑 / 挥爪（随机）；怪物法术 / 法宝 = 原地前扑 / 挥手（随机）
      // 普攻：先算出跑到对方面前要走多远（--dx，像素），再播放动作
      const mv = c => { if (k === 0) { const im = el => (el.querySelector("img") || el).getBoundingClientRect(), a = im(me), t = im(tg);
          const dx = w ? (t.right - a.left) - a.width * 0.25 : (t.left - a.right) + a.width * 0.25; me.style.setProperty("--dx", Math.round(dx) + "px"); }
        re(me, c); if (k !== 0 && (k === 1 || k === 2)) me.classList.add("btv-cast"); };
      if (k === 1 || k === 2) { if (w) mv(Math.random() < 0.5 ? "btv-mpounce" : "btv-mwave"); }
      if (k === 0) { if (w) mv(["btv-pounce-r", "btv-claw-r", "btv-wave-r"][Math.floor(Math.random() * 3)]); else re(me, "btv-hact"); setTimeout(hit, 430 * SL); }
      else if (k === 1) { if (!w) { re(me, "btv-hact"); me.classList.add("btv-cast"); } add("btv-orb " + (w ? "go-l" : "go-r") + (el ? " el-" + el : ""), "", w, 700); setTimeout(hit, 520 * SL); }
      else if (k === 2) { if (!w) { re(me, "btv-hact"); me.classList.add("btv-cast"); } add("btv-fb " + (w ? "go-l" : "go-r"), "", w, 800); setTimeout(hit, 600 * SL); }
      else if (k === 3) { this.btRing(w, true); this.btHp(); }
      else if (k === 4) { add("btv-pop gray", "眩晕", w); this.btHp(); }
      else { add("btv-shield gold", "", w, 1000); this.btHp(); }
    },
    // v165 护盾光圈：护盾在的时候一直显示，套住人物 / 怪物（比人物大一点），破碎时消失
    btRing(w, on) {
      const u = $("#bt-u" + w); if (!u) return;
      let r = u.querySelector(".btv-ring");
      if (!on) { if (r) { r.classList.add("off"); setTimeout(() => r.remove(), 500); } return; }
      if (r) r.remove();
      const im = (u.querySelector(".btv-hero") || u.querySelector("img") || u).getBoundingClientRect(), ur = u.getBoundingClientRect();
      r = document.createElement("div"); r.className = "btv-ring" + (w ? " mob" : "");
      const W2 = im.width * 1.3, H2 = im.height * 1.1;
      Object.assign(r.style, { width: W2 + "px", height: H2 + "px", left: (im.left - ur.left + im.width / 2 - W2 / 2) + "px", top: (im.top - ur.top + im.height / 2 - H2 / 2) + "px" });
      u.appendChild(r);
    },
    btFinish() {
      const bp = this._bp; if (!bp || bp.done) return;
      clearInterval(bp.timer); clearTimeout(bp.skipT);
      while (bp.shown < bp.acts.length) this.btAct(bp.acts[bp.shown++], false);
      const last = bp.acts[bp.acts.length - 1]; if (last) bp.hp = [last[6], last[8]];
      bp.done = true; this.btHp(); this.battleDone(bp);
      const log = $("#bt-log"); if (log) { log.insertAdjacentHTML("beforeend", `<p class="bt-res ${bp.win ? "win" : "lose"}">${bp.txt}</p>${this.battleHead(bp.b)}`); log.scrollTop = 1e9; }
      this.btBtn();
    },
    // 播放完：这时才在信息栏提示胜负（只提示一次）
    battleDone(bp) { if (bp.logged) return; bp.logged = true; bp.logs.forEach(([m, c]) => this.log(m, c)); },
    skipBattle() { if (this.btCanSkip()) this.btFinish(); },
    closeBattle() { if (this._bp) { clearInterval(this._bp.timer); clearTimeout(this._bp.skipT); this.battleDone(this._bp); } this._bp = null; this._lockModal = false; this.closeModal(); this.render(); if (this._backHist) { this._backHist = false; this.openExHist(); } },

    /* ---------- 掉落 ---------- */
    newLoot() { return { stone: 0, mats: {} }; },
    // 掉落：config/drops.js 里该地图的掉落组（数量 × 该地图 mat 倍率）
    rollEvent(loot, ev, a) { return this.rollEventMats(loot, ev, a); },
    // 药材矿石掉落：rule = 秘境的 { kinds, n }（不传按地图自己的规则）；特产 fixed 组必定掉
    rollEventMats(loot, ev, a, mulSet, rule) {
      const groups = DATA.mapDrop(a, ev, rule), mul = mulSet !== undefined ? mulSet : DATA.mapMat(a);
      if (!groups) return "";
      const got = [];
      const add = (name, n0) => { const m = DATA.matByName[name], n = n0 > 0 ? Math.max(1, Math.round(n0 * mul)) : 0;
        if (!m || n <= 0) return; const key = m.kind + "|" + name;
        (loot.mats[key] = loot.mats[key] || { kind: m.kind, name, g: m.g, n: 0 }).n += n; got.push(`${name}×${U.fmt(n)}`); };
      for (const gr of groups) {
        // 必定掉落：药材矿石 × mul；其它（专用材料、自定义物品）按原数量
        if (gr.fixed) { for (const name in gr.fixed) { const r = gr.fixed[name] || [1, 1], n = U.rand(r[0], r[1]);
          if (DATA.matByName[name]) add(name, n); else if (n > 0) { const t = this.lootAdd(loot, name, n); if (t) got.push(t); } } continue; }
        // v236 随机药材矿石不在这里掉，改按 CFG.dropTotal 总量分到各步（见 matPlan / stepMats）
      }
      return got.join("、");
    },
    // v236 本次探索的药材 / 矿石总量（CFG.dropTotal），分配到各步：返回 { 步序号: [药材个数, 矿石个数] }
    //   药材可落在 灵药 / 怪物 步，矿石可落在 矿脉 / 怪物 步；挖灵石矿（kuang）不掉
    matPlan(x) {
      const T = CFG.dropTotal || {}, plan = x.plan || "", mp = {};
      if (x.kuang) return mp;
      const tk = x.mj === undefined ? "explore" : x.mk === "ld" ? "lingdi" : "mijing", t = T[tk] || {};
      const pick = (r, ok, j) => { if (!r) return; const n = U.rand(r[0], r[1]), idx = [];
        for (let i = 0; i < plan.length; i++) if (ok.includes(plan[i])) idx.push(i);
        if (!idx.length) idx.push(plan.length - 1);
        for (let k = 0; k < n; k++) { const i = U.pick(idx); (mp[i] = mp[i] || [0, 0])[j]++; } };
      pick(t.herb, "hmeb", 0); pick(t.ore, "omeb", 1);
      return mp;
    },
    // 本次探索用哪张地图的药材矿石池：地图 / 秘境 drops / 灵地发现地图
    matPoolMap(x) { if (x.mj === undefined) return x.map; const d = this.mjDef(x.mj, x.mk); return x.mk === "ld" ? d._map : d.drops; },
    // 第 i 步分到的药材矿石：每个从池里等权重随机，写进 loot，返回描述
    stepMats(x, i) {
      const c = (x.mp || {})[i]; if (!c) return "";
      const pool = DATA.mapPool(this.matPoolMap(x)), cnt = {};
      ["herb", "ore"].forEach((k, j) => { const L = pool[k]; if (!L.length) return; for (let n = 0; n < c[j]; n++) { const name = U.pick(L); cnt[name] = (cnt[name] || 0) + 1; } });
      return Object.keys(cnt).map(n => this.lootAdd(x.loot, n, cnt[n])).filter(Boolean).join("、");
    },
    // 击败怪物的掉落，写进 loot，返回描述文字
    //   mj = 秘境序号（秘境：灵石倍率、掉落按 config/mijing.js）
    //   mk = "ld"：灵地（config/lingdi.js）
    // CFG.drop.RUN_STONE：w 界、区域层序 L 时每只普通怪的灵石基数
    runStonePer(w, L) {
      const E = CFG.drop, R = E.RUN_STONE[w || "fan"];
      if (!this._rsL) this._rsL = {};
      let b = this._rsL[w];
      if (!b) { b = [Infinity, -Infinity]; DATA.maps.forEach((mp, i) => { if ((mp.w || "fan") !== (w || "fan")) return; for (let r = 0; r < DATA.regionCount; r++) { const l = DATA.region(i, r).L; if (l < b[0]) b[0] = l; if (l > b[1]) b[1] = l; } }); this._rsL[w] = b; }
      const t = b[1] > b[0] ? Math.max(0, Math.min(1, (L - b[0]) / (b[1] - b[0]))) : 0, X = CFG.explore;
      const den = 1.75 * (X.MONSTERS + X.ELITES * E.ELITE_STONE + X.BOSS * E.BOSS_STONE);
      return (R[0] + (R[1] - R[0]) * t) / den;
    },
    rollMonsterLoot(loot, m, a, mj, mk) {
      const E = CFG.drop, mult = m.boss ? E.BOSS_STONE : m.elite ? E.ELITE_STONE : 1, ev = m.boss ? "boss" : m.elite ? "elite" : "monster";
      const sm = (mj !== undefined ? (this.mjDef(mj, mk).stone || 1) : DATA.mapStone(a)) * (E.MAP_STONE || 1);   // v200 地图 / 秘境 / 灵地怪物灵石 × MAP_STONE（灵矿不乘）
      const w = mj !== undefined ? (mk === "ld" ? this.mjDef(mj, mk).w : "fan") : DATA.maps[a].w, per = this.runStonePer(w, m.Lm);
      const raw = per * (1 + Math.random() * 1.5) * E.STONE_RATE * mult * sm;
      const stone = Math.floor(raw + Math.random());   // 随机取整，平均值不被向下取整吃掉
      loot.stone += stone;
      const mats = mj !== undefined ? this.rollMj(loot, ev, mj, mk) : this.rollEvent(loot, ev, a);
      return `灵石${U.fmt(stone)}${mats ? "、" + mats : ""}`; // 怪物不掉丹药、装备
    },
    // 把收获放进背包，返回简短描述
    giveLoot(loot) {
      const s = this.s, parts = [], o = this._off;
      if (o) {   // 离线账本（core/game.js offlineReport）；v173 出窍单独记
        const cq = s.explore && s.explore.cq, L = cq ? o.cq : o;
        if (cq) { o.cq.runs++; o.cq.stone += loot.stone; } else { o.exRuns++; o.exStone += loot.stone; }
        const add = (k, n) => { L.exItems[k] = (L.exItems[k] || 0) + n; o.allItems[k] = (o.allItems[k] || 0) + n; };
        for (const k in loot.mats) { const x = loot.mats[k]; add(DATA.matFull(x.kind, x.g), x.n); }
        for (const name in loot.cu || {}) add(name, loot.cu[name]);
        if (loot.hx) add(DATA.HX, loot.hx);
        for (const k in loot.sm || {}) { const p = DATA.smParse(k); add(DATA.smName(p.k, p.ft, p.tier), loot.sm[k]); }
      }
      s.stone += loot.stone; if (loot.stone) parts.push(`灵石${U.fmt(loot.stone)}`);
      let lost = 0;
      for (const k in loot.mats) { const x = loot.mats[k]; if (this.addMat(x.kind, x.name, x.g, x.n)) parts.push(`${DATA.matFull(x.kind, x.g)}×${U.fmt(x.n)}`); else lost++; }
      for (const name in loot.cu || {}) { if (this.addCustom(name, loot.cu[name])) parts.push(`${name}×${U.fmt(loot.cu[name])}`); else lost++; } // 自定义物品
      if (loot.hx) { if (this.addFire(loot.hx)) parts.push(`${DATA.HX}×${U.fmt(loot.hx)}`); else lost++; }   // 秘境：火髓、专用材料
      for (const k in loot.sm || {}) { const p = DATA.smParse(k);
        if (this.addSm(p.k, loot.sm[k], p.ft, p.tier)) parts.push(`${DATA.smName(p.k, p.ft, p.tier)}×${U.fmt(loot.sm[k])}`); else lost++; }
      if (o) o.exLost += lost;
      return parts.join("、") + (lost ? `（背包已满，遗失 ${lost} 件）` : "");
    },

    /* ---------- 自动探索 ---------- */
    // once = true：历练（只走一次）；否则自动探索（需先历练通过该区域）
    toggleExplore(a, r, once) {
      const s = this.s;
      if (s.explore && !s.explore.cq && s.explore.map === a && s.explore.reg === r && !!s.explore.once === !!once) { this.stopExplore(once ? "放弃历练" : "停止自动探索"); return this.after(); }
      if (this.cqBusy()) return;
      if (!this.regionOpen(a, r)) return;
      if (!once && !this.isTrained(a, r)) return this.log("需先在此区域历练通过，才能自动探索。", "sys");
      if (s.explore) this.stopExplore("更换");
      if (once && s.hp < this.stats().hp * DATA.EXPLORE_STOP) return this.log("生命不足三成，先休养片刻（每 10 秒恢复 1%）。", "sys");
      s.explore = { map: a, reg: r, once: !!once, start: this.now(), step: 0, count: 0, loot: this.newLoot(), ev: [], last: "", plan: this.makePlan(), ms: this.exploreMs() };
      if (!once && !this.exReady()) { s.explore.rest = 1; this.log(`${this.exReadyTxt()}，先原地休养，恢复后自动开始。`, "sys"); }
      s.lastRun = null;
      this.exploreOpen = true;
      this.log(`开始在${DATA.regionName(a, r)}${once ? "历练" : "自动探索"}（期间无法修炼）。`, "sys");
      this.after();
    },
    /* ---------- 元婴出窍（config/sect.js 的 CFG.chuqiao）：自动探索指定次数，期间可以继续修炼 ---------- */
    openChuqiao(a, r) {
      const s = this.s, C = CFG.chuqiao, x = s.explore;
      if (x && x.cq && x.map === a && (x.reg || 0) === r) { this.stopExplore("结束出窍"); return this.after(); }
      if (this.cqBusy()) return;
      if (!s.cqLearn) return this.log(`需先在宗门宝库兑换${C.NAME}。`, "sys");
      if (this.cqLeftToday() <= 0) return this.log("今天的出窍次数已用完。", "sys");
      if (!this.realmOK(C.REALM)) return this.log(`出窍需要${DATA.realmLabel(C.REALM)}。`, "sys");
      if (r >= 0 && !this.isTrained(a, r)) return this.log("需先在此区域历练通过，才能出窍探索。", "sys");
      if (r < 0 ? !this.mapOpen(a) : !this.regionOpen(a, r)) return;
      const max = this.cqLeftToday();
      this.modal(`<h2>元婴出窍 · ${r < 0 ? this.kuangName(a) : DATA.regionName(a, r)}</h2>
        <p>神识强度 ${s.ssPow || 0}，今天还能出窍探索 ${max} 次；出窍期间可以继续修炼。开始时先扣次数，中途停止只扣已完成和正在进行的，剩下的返还。</p>
        <div class="line"><div>出窍次数<small>1 ~ ${max}</small></div><input id="cq-n" type="number" min="1" max="${max}" value="${max}" style="width:110px"></div>
        <div class="btns"><button class="primary" onclick="G.startChuqiao(${a},${r})">出窍</button><button onclick="G.closeModal()">取消</button></div>`);
    },
    startChuqiao(a, r, nAuto) {   // nAuto：自动任务直接给次数（不弹窗）
      const s = this.s, max = this.cqLeftToday(), n = Math.min(max, Math.floor(nAuto || +($("#cq-n") && $("#cq-n").value) || 0));
      if (n < 1) return;
      if (!nAuto) this.closeModal();
      if (s.explore) this.stopExplore("更换");
      this.cqUse(n);   // 开始先扣次数，停止时返还没走的（stopExplore）
      s.explore = { map: a, reg: r, once: false, cq: n, start: this.now(), step: 0, count: 0, loot: this.newLoot(), ev: [], last: "", plan: r < 0 ? this.kuangPlan() : this.makePlan(), ms: this.exploreMs() };
      if (r < 0) s.explore.kuang = 1;   // 灵矿
      if (r >= 0 && !this.exReady()) { s.explore.rest = 1; this.log(`${this.exReadyTxt()}，先原地休养，恢复后自动开始出窍。`, "sys"); }
      s.lastRun = null;
      this.exploreOpen = true;
      this.log(`元婴出窍，前往${r < 0 ? this.kuangName(a) : DATA.regionName(a, r)}探索 ${n} 次（期间可以继续修炼）。`, "sys");
      this.after();
    },
    // 停止：本次已获得的东西也结算
    // 正在出窍时不能历练 / 探索，要先停止出窍
    cqBusy() { if (this.s.explore && this.s.explore.cq) { this.log("正在元婴出窍，请先停止出窍。", "sys"); return true; } return false; },
    stopExplore(why) {
      const x = this.s.explore; if (!x) return;
      if (x.cq) { const back = Math.max(0, x.cq - x.count - (x.rest ? 0 : 1)); this.cqRefund(back); if (back) why += `，返还 ${back} 次出窍`; }   // 正在进行的这次扣除，剩下的返还
      const got = this.giveLoot(x.loot);
      this.log(`${why}，${x.mj !== undefined ? `离开${this.exName(x)}` : `共完成 ${x.count} 次探索`}${got ? "，本次收获 " + got : ""}。`, "sys");
      this.s.explore = null;
    },
    // 走一步：随机事件
    exploreStep() {
      const x = this.s.explore, a = x.map, r = x.reg || 0, mj = x.mj, mk = x.mk;
      if (!x.plan) x.plan = this.exPlan(x);
      if (x.step === 0 || !x.mp) x.mp = this.matPlan(x);   // v236 每次开始：定好本次药材 / 矿石总量
      const si = x.step, sm = () => this.stepMats(x, si);
      const type = { n: "nothing", m: "monster", e: "elite", b: "boss", h: "herb", o: "ore", k: "kuang" }[x.plan[x.step]] || "nothing";
      x.step++;
      // 每走一步恢复生命、法力（HEAL_STEP + 宗门秘法「斗血 / 斗灵」）；战斗回合中不恢复
      const st = this.stats(), H = this.regenStep();
      this.s.hp = Math.min(st.hp, this.s.hp + st.hp * H.hp / 100 + (H.hpFlat || 0)); this.s.mana = Math.min(st.mana, this.s.mana + st.mana * H.mana / 100 + (H.manaFlat || 0));
      let t = "", c = "", bd = null;
      const roll = ev => mj !== undefined ? this.rollMj(x.loot, ev, mj, mk) : this.rollEvent(x.loot, ev, a);
      if (type === "kuang") { const g = this.kuangStone(a); x.loot.stone += g; t = `挖掘灵石矿，获得灵石 ${U.fmt(g)}`; c = "good"; }
      else if (type === "herb" || type === "ore") {   // v199 什么都没得到时不显示「发现灵药 / 矿脉，获得 无」，当作普通一步
        const g = [roll(type === "herb" ? "herbEvent" : "oreEvent"), sm()].filter(Boolean).join("、");
        if (g) { t = type === "herb" ? `发现灵药，采得 ${g}` : `发现矿脉，挖得 ${g}`; c = "good"; }
        else t = U.pick(DATA.exploreIdle);
      }
      else if (type === "monster" || type === "elite" || type === "boss") {
        const kind = type === "monster" ? "normal" : type, m = mj !== undefined ? this.makeMjMob(mj, kind, mk) : this.makeMob(a, r, kind);
        m.a = a;
        const res = this.battle(m, { foe: m.boss ? "boss" : m.elite ? "elite" : "mob" }), tag = `${m.boss ? "【首领】" : m.elite ? "【精英】" : ""}${String(m.name).replace(/^精英·/, "")}`;
        if (res.win) { this.s.kills++; t = `遭遇${tag}，${res.rounds}回合击败，获得 ${[this.rollMonsterLoot(x.loot, m, a, mj, mk), sm()].filter(Boolean).join("、")}`; c = m.boss ? "gold" : ""; }
        else if (res.lose) { t = `遭遇${tag}，${res.timeout ? `${res.rounds} 回合未能击败，力竭重伤` : `第 ${res.rounds} 回合不敌重伤`}，本次探索收获全部遗失。${res.why}`; c = "bad"; }
        else { const g = sm(); t = `遭遇${tag}，缠斗 ${res.rounds} 回合，各自退去${g ? `，拾得 ${g}` : ""}`; }
        bd = res.detail;
      } else t = U.pick(DATA.exploreIdle);
      x.ev.unshift(bd ? { n: x.step, t, c, b: bd } : { n: x.step, t, c });   // b：完整战斗过程（点「详情」看）
      if (x.ev.length > this.exCfg(x).TIME) x.ev.length = this.exCfg(x).TIME;
      return c === "bad"; // 战败：本次提前结束
    },
    // 生成一次探索的事件顺序（字符串，每个字符一步）：首领固定在最后一步
    makePlan(E = CFG.explore) {
      const T = E.TIME;
      const list = [...Array(E.MONSTERS).fill("m"), ...Array(E.ELITES || 0).fill("e"), ...Array(U.rand(E.HERB_MIN, E.HERB_MAX)).fill("h"), ...Array(U.rand(E.ORE_MIN, E.ORE_MAX)).fill("o")];
      while (list.length < T - E.BOSS) list.push("n");
      list.length = T - E.BOSS;
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      return list.join("") + "b".repeat(E.BOSS);
    },
    // 每走一步的毫秒数 = STEP_SEC − 宗门秘法「神行」（只影响历练 / 探索走路，最少 STEP_MIN 秒）
    exploreMs() { const E = CFG.explore; return Math.round(Math.max(E.STEP_MIN || 0.5, (E.STEP_SEC || 1) - this.mifaBonus().explore) * 1000); },
    // v242 自动探索 / 出窍能否继续：生命 ≥ 战斗设置 goHp%且 法力 ≥ goMp%
    exGo() { const b = this.bsetGet(), st = this.stats(); return { hp: st.hp * Math.min(100, b.goHp || 0) / 100, mp: st.mana * Math.min(100, b.goMp || 0) / 100 }; },
    exReady() { const g = this.exGo(); return this.s.hp >= g.hp - 1e-6 && this.s.mana >= g.mp - 1e-6; },
    exReadyTxt() { const g = this.exGo(), b = this.bsetGet(); return this.s.hp < g.hp - 1e-6 ? `生命低于 ${U.num(b.goHp)}%` : `法力低于 ${U.num(b.goMp)}%`; },
    // 推进到当前时间（每 exploreMs 走一步；满 TIME 步结算一次）
    advanceExplore() {
      const s = this.s;
      if (!s.explore) return;
      let x = s.explore; const T = this.exCfg(x).TIME;
      let changed = false;
      if (!x.ms) x.ms = this.exploreMs();
      if (x.rest) {   // v186 探索 / 出窍：生命不足时原地休养，恢复满后自动继续
        if (!this.exReady()) return;
        x.rest = 0; x.start = this.now(); x.step = 0; x.loot = this.newLoot(); x.ev = []; x.plan = this.exPlan(x);
        this.log(`生命、法力已恢复，继续${x.cq ? "出窍探索" : "自动探索"}。`, "sys"); changed = true;
      }
      const W = (CFG.explore.END_WAIT || 0) * 1000;   // v203 走完最后一步：先显示出来，固定再等 END_WAIT 秒才结算（「神行」不影响）
      const due = () => x.lostWait ? x.start + (x.step + 1) * x.ms : x.step >= T ? x.start + T * x.ms + W : x.start + (x.step + 1) * x.ms;
      while (s.explore && this.now() >= due()) {
        changed = true;
        const at = due();   // 这次结算的时间：下一次从这里开始
        // 战败：先把战败那一步显示出来，再等一步的时间才结算「探索失败」
        let lost = false;
        if (x.lostWait) { lost = true; x.lostWait = 0; }
        else if (x.step < T) { if (this.exploreStep()) x.lostWait = 1; continue; }
        if (x.step >= T || lost) {
          // 结算本次
          x.count++;
          if (lost) x.loot = this.newLoot();   // v187 战败：只丢本次收获（物品 + 灵石），不扣身上灵石
          const got = this.giveLoot(x.loot);
          x.last = `${x.once ? "历练" : x.mj !== undefined ? "探索" : `第 ${x.count} 次探索`}${lost ? `（第 ${x.step} 步战败，提前结束）` : ""}：${got || "一无所获"}`;
          this.log(x.mj !== undefined ? this.exName(x) + x.last : x.last, lost ? "bad" : "gold");
          // 保存这一次的全部事件，结束后也能查看（含失败那一步）
          s.lastRun = { title: `${this.exName(x)} · ${x.last}`, ev: x.ev.slice(), bad: lost };
          this.exHistAdd(s.lastRun);   // v204 全部探索：保留最近 EX_HIST 次
          if (x.mj !== undefined) { if (!this.mjFinish(x, lost)) break; x = s.explore; continue; }   // 秘境：每处只走一次，一键探索接着走下一处
          if (!lost && !x.kuang) this.mjDiscover(x.map);   // 地图走完一次：有几率发现秘境（凡界）/ 灵地（四界）
          if (x.once) { // 历练只走一次；走完且未战败 = 通过，解锁该区域自动探索
            const key = this.regionKey(x.map, x.reg || 0);
            if (!lost && DATA.maps[x.map].w !== "fan" && this.xjGxAdd) { const g = CFG.xingjun.CONTRIB_RUN || 0; if (g) { this.xjGxAdd(x.map, g); this.log(`${DATA.maps[x.map].name}贡献 +${g}`, "gold"); } }   // 四界地图：完成一次历练得本图贡献（config/xingjun.js）
            if (!lost && !s.trainedR.includes(key)) { s.trainedR.push(key); this.log(`${DATA.regionName(x.map, x.reg || 0)}历练通过！已可自动探索。`, "gold"); }
            else if (lost) this.log("历练失败，提升实力后再来。", "bad");
            s.explore = null; break;
          }
          if (x.cq && x.count >= x.cq) {   // 元婴出窍：探索够次数就回来
            this.log(`出窍探索 ${x.count} 次已完成，元婴归窍。`, "gold");
            s.explore = null; break;
          }
          if (!this.exReady()) {   // v242 生命 / 法力低于战斗设置的「继续探索」：原地休养，恢复到了再继续
            this.log(`${this.exReadyTxt()}，原地休养，恢复后自动继续（已探索 ${x.count} 次）。`, "bad");
            x.rest = 1; x.step = 0; x.loot = this.newLoot(); x.ev = []; break;
          }
          x.start = at; x.ms = this.exploreMs(); x.step = 0; x.loot = this.newLoot(); x.ev = []; x.plan = this.exPlan(x);
          s.lastRun = null; // 开始新一次：不保留上一次的记录
        }
      }
      if (changed) this.dirty();
    },
    /* ---------- 秘境（config/mijing.js）、灵地（config/lingdi.js）：共用一套，k = "mj" 秘境（默认）/ "ld" 灵地 ---------- */
    exCfg(x) { return x && x.mj !== undefined ? this.mjCfg(x.mk) : x && x.kuang ? CFG.explore.KUANG : CFG.explore; },
    exPlan(x) { return x.kuang ? this.kuangPlan() : this.makePlan(this.exCfg(x)); },
    exName(x) { return x.mj !== undefined ? this.mjLabel(x.mk) + "·" + this.mjDef(x.mj, x.mk).name : x.kuang ? this.kuangName(x.map) : DATA.regionName(x.map, x.reg || 0); },
    mjCfg(k) { return k === "ld" ? CFG.lingdi : CFG.mijing; },
    mjLabel(k) { return k === "ld" ? DATA.nmPick(CFG.names.mjLabel, "ld", "灵地") : DATA.nmPick(CFG.names.mjLabel, "mj", "秘境"); },   // 名字在 config/names.js 的 mjLabel
    mjDef(i, k) { return this.mjCfg(k).list[i]; },
    mjToday() { const d = new Date(this.now()); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; },
    // 秘境 / 灵地存档（换日自动清空今天的次数）
    mjState(k) {
      const s = this.s, key = k === "ld" ? "ld" : "mj", m = s[key] || (s[key] = { found: [], trained: [], day: "", used: {} }), t = this.mjToday();
      if (m.day !== t) { m.day = t; m.used = {}; }
      return m;
    },
    mjLeft(i, k) { return Math.max(0, (this.mjCfg(k).DAILY || 1) - (this.mjState(k).used[i] || 0)); },
    // 地图走完一次：凡界地图 → 秘境（find.map = 凡界地图序号）；四界地图 → 灵地（这一界第 find.map 张）
    //   每处在这张地图能发现、还没发现的按 find.chance% 判定，一次最多发现一处（秘境、灵地各算）
    mjDiscover(a) {
      for (const k of ["mj", "ld"]) {
        const C = this.mjCfg(k); if (!C || !C.list) continue;
        const m = this.mjState(k);
        for (let i = 0; i < C.list.length; i++) {
          const d = C.list[i], at = k === "ld" ? d._map : d.find && d.find.map;
          if (m.found.includes(i) || !d.find || at !== a || Math.random() * 100 >= (d.find.chance || 0)) continue;
          m.found.push(i);
          this.log(k === "ld" ? `探得灵地消息：发现${(DATA.worlds.find(w => w.id === d.w) || {}).name || ""}灵地「${d.name}」（需${DATA.realmLabel(d.realm)}）！可在 仙冥魔神任一地图 → 灵地 进入。`
            : `探得秘境消息：发现「${d.name}」（需${DATA.realmLabel(d.realm)}）！可在 历练 → 秘境 进入。`, "gold");
          break;
        }
      }
    },
    // 秘境 / 灵地怪物：属性在 js/data/mobs.js 按 config/mobs.js 生成
    makeMjMob(i, kind, k) {
      const d = this.mjDef(i, k), b = DATA.mobMeet(d, kind), v = (x, k) => x * DATA.mobRnd(k);
      const name = kind === "boss" ? d.bossName : (kind === "elite" ? "精英·" : "") + U.pick(d.monsters);
      return this.addMagic({ name, Lm: d.L, kind, boss: kind === "boss", elite: kind === "elite",
        hp: v(b.hp, "hp"), atk: v(b.atk, "atk"), def: v(b.def, "def"), speed: v(b.speed, "speed"), hit: v(b.hit, "hit"), dodge: v(b.dodge, "dodge"), mana: v(b.mana, "mana"), res: b.res, manaBr: b.manaBr, L: b.L, crit: b.crit }, kind);
    },
    // 秘境 / 灵地掉落：extra 必掉 / 几率掉落（药材矿石总量见 CFG.dropTotal，按步分配，stepMats）
    //   秘境借用 drops 那张凡界地图；灵地借用发现地图（这一界的药材矿石表）
    rollMj(loot, ev, i, k) {
      const d = this.mjDef(i, k);
      const got = [];   // v236 随机药材矿石改按 CFG.dropTotal 总量（stepMats）；这里只掉必掉的 extra
      for (const x of (d.extra || {})[ev] || []) {
        if (Math.random() * 100 >= (x.chance || 0)) continue;
        const nn = x.n || [1, 1], n = U.rand(nn[0], nn[1]); if (n <= 0) continue;
        const t = this.lootAdd(loot, x.item, n); if (t) got.push(t);
      }
      return got.filter(Boolean).join("、");
    },
    // 按名字把东西记进 loot：火髓 / 专用材料 / 药材矿石 / 自定义物品
    //   耀石 / 灵晶：名字是「耀石」「灵晶」（没写属性）每个随机一种属性
    lootAdd(loot, name, n) {
      if (name === DATA.HX) { loot.hx = (loot.hx || 0) + n; return `${DATA.HX}×${n}`; }
      const sm = DATA.smByName(name);
      if (sm) {
        loot.sm = loot.sm || {};
        if (!(DATA.SM_GRADED.includes(sm.k) && sm.ft === undefined)) { const key = DATA.smKey(sm.k, sm.ft); loot.sm[key] = (loot.sm[key] || 0) + n; return `${DATA.smName(sm.k, sm.ft)}×${n}`; }
        const cnt = {};
        const nk = ((CFG.mijing.items[sm.k] || {}).names || DATA.elements).length;
        for (let j = 0; j < n; j++) { const key = DATA.smKey(sm.k, Math.floor(Math.random() * nk)); loot.sm[key] = (loot.sm[key] || 0) + 1; cnt[key] = (cnt[key] || 0) + 1; }
        return Object.keys(cnt).map(key => `${DATA.smName(sm.k, DATA.smParse(key).ft)}×${cnt[key]}`).join("、");
      }
      const m = DATA.matByName[name];
      if (m) { const key = m.kind + "|" + name; (loot.mats[key] = loot.mats[key] || { kind: m.kind, name, g: m.g, n: 0 }).n += n; return `${name}×${n}`; }
      if (this.cuDef(name)) { loot.cu = loot.cu || {}; loot.cu[name] = (loot.cu[name] || 0) + n; return `${name}×${n}`; }
      return "";
    },
    mjCanEnter(i, k) { const d = this.mjDef(i, k); return !!d && this.mjState(k).found.includes(i) && this.r() >= d.realm && this.mjLeft(i, k) > 0; },
    // 开始走一处秘境 / 灵地（扣今天的次数）；x = 正在走的探索（一键探索接着走）
    mjStart(i, once, queue, x, k) {
      const s = this.s, st = this.mjState(k), d = this.mjDef(i, k); st.used[i] = (st.used[i] || 0) + 1;
      const n = { map: -1, reg: 0, mj: i, once: !!once, queue: queue || [], start: x ? x.start + x.step * x.ms : this.now(), step: 0, count: 0, loot: this.newLoot(), ev: [], last: "", plan: this.makePlan(this.mjCfg(k)), ms: this.exploreMs() };
      if (k === "ld") n.mk = "ld";
      else if (d.realm === CFG.chuqiao.LU_MJ_REALM && CFG.chuqiao.LU_DROP > 0) this.lootAdd(n.loot, DATA.smName("lu"), CFG.chuqiao.LU_DROP);   // 元婴期秘境必定掉落养神露
      s.explore = n; s.lastRun = x ? s.lastRun : null;
      this.log(`进入${this.mjLabel(k)}「${d.name}」${once ? "历练" : "探索"}（期间无法修炼）。`, "sys");
    },
    // 历练 / 探索一处秘境 / 灵地
    toggleMj(i, once, k) {
      const s = this.s, x = s.explore, L = this.mjLabel(k);
      if (x && x.mj === i && (x.mk || "mj") === (k || "mj")) { this.stopExplore(once ? "放弃历练" : "停止探索"); return this.after(); }
      if (this.cqBusy()) return;
      const d = this.mjDef(i, k), m = this.mjState(k);
      if (!d || !m.found.includes(i)) return;
      if (!this.realmOK(d.realm)) return;
      if (!once && !m.trained.includes(i)) return this.log(`需先历练通过这处${L}，才能自动探索。`, "sys");
      if (this.mjLeft(i, k) <= 0) return this.log(`这处${L}今天已经进过了，明天再来。`, "sys");
      if (s.hp < this.stats().hp * DATA.EXPLORE_STOP) return this.log("生命不足三成，先休养片刻。", "sys");
      if (x) this.stopExplore("更换");
      this.mjStart(i, once, null, null, k); this.exploreOpen = true; this.after();
    },
    // 一键探索：今天还没进过、已历练通过的秘境 / 灵地依次自动探索
    mjAll(k) {
      const s = this.s, m = this.mjState(k), list = m.found.filter(i => m.trained.includes(i) && this.mjCanEnter(i, k)).sort((a, b) => a - b);
      if (this.cqBusy()) return;
      if (!list.length) return this.log(`没有可以探索的${this.mjLabel(k)}（要已发现、已历练通过、今天还没进过）。`, "sys");
      if (s.hp < this.stats().hp * DATA.EXPLORE_STOP) return this.log("生命不足三成，先休养片刻。", "sys");
      if (s.explore) this.stopExplore("更换");
      this.mjStart(list[0], false, list.slice(1), null, k); this.exploreOpen = true; this.after();
    },
    // 秘境 / 灵地走完一处：历练通过记下；一键探索接着下一处。返回 true = 还在继续
    mjFinish(x, lost) {
      const s = this.s, k = x.mk, m = this.mjState(k), name = this.mjDef(x.mj, k).name, L = this.mjLabel(k);
      if (x.once) {
        if (!lost && !m.trained.includes(x.mj)) { m.trained.push(x.mj); this.log(`${L}「${name}」历练通过！以后可以自动探索。`, "gold"); }
        else if (lost) this.log(`${L}历练失败，明天提升实力再来。`, "bad");
      }
      const q = (x.queue || []).filter(i => this.mjCanEnter(i, k));
      if (lost || !q.length) { s.explore = null; if (x.queue && x.queue.length && lost) s.lastRun.title += "；战败，一键探索停止"; return false; }
      if (s.hp < this.stats().hp * DATA.EXPLORE_STOP) { this.log("生命不足三成，一键探索停止。", "bad"); s.lastRun.title += "；生命不足三成，一键探索停止"; s.explore = null; return false; }
      this.mjStart(q[0], false, q.slice(1), x, k);
      return true;
    },
    stopNow() { const x = this.s.explore; if (x) this.stopExplore(x.once ? "放弃历练" : "停止探索"); this.after(); },
    // 一处秘境 / 灵地的一行（历练 / 探索按钮）
    mjRow(i, k) {
      const s = this.s, m = this.mjState(k), d = this.mjDef(i, k), x = s.explore, ka = k === "ld" ? ",'ld'" : "";
      const lock = !this.realmOK(d.realm), ok = m.trained.includes(i), left = x && x.cq ? 0 : this.mjLeft(i, k), on = x && x.mj === i && (x.mk || "mj") === (k || "mj");   // 出窍中不能进
      return `<div class="line"><div>${k === "ld" ? DATA.li("img/hall_lingdi.png") : ""}${d.name}<span class="tag">需${DATA.realmLabel(d.realm)}</span><small>首领 ${d.bossName} · ${ok ? "已通过历练" : "未历练"} · 今天${left > 0 ? `还能进 ${left} 次` : "已进过"}</small></div>
          ${lock ? `<button class="sm" disabled>境界不足</button>` : `<div><button class="sm ${on && x.once ? "on" : ""}" onclick="G.toggleMj(${i},true${ka})" ${on ? "" : left > 0 ? "" : "disabled"}>${on && x.once ? "停止" : "历练"}</button>
          <button class="sm ${on && !x.once ? "on" : ""}" onclick="G.toggleMj(${i},false${ka})" ${on ? "" : ok && left > 0 ? "" : "disabled"}>${on && !x.once ? "停止" : "探索"}</button></div>`}</div>`;
    },
    mjReady(k) { const m = this.mjState(k), x = this.s.explore; return x && x.cq ? 0 : m.found.filter(i => m.trained.includes(i) && this.mjCanEnter(i, k)).length; },
    mijingView() {
      const m = this.mjState(), L = CFG.mijing.list, ready = this.mjReady();
      const rows = m.found.slice().sort((a, b) => a - b).map(i => this.mjRow(i)).join("");
      return `<div class="card"><h3>${this.mjLabel("mj")}<small>已发现 ${m.found.length} / ${L.length}</small></h3>
        ${rows || `<p class="desc">还没有发现秘境。在凡界地图历练、自动探索时，有几率探得秘境消息。</p>`}
        ${m.found.length ? `<div class="btns"><button class="primary" onclick="G.mjAll()" ${ready ? "" : "disabled"}>一键探索（${ready} 处）</button></div>` : ""}</div>`;
    },
    // 灵地：在仙冥魔神任一地图的「灵地」里显示四界全部已发现的灵地（按界分组）
    lingdiView() {
      const m = this.mjState("ld"), L = (CFG.lingdi || {}).list || [], ready = this.mjReady("ld");
      const groups = ["xian", "ming", "mo", "shen"].map(w => {
        const ids = m.found.filter(i => L[i] && L[i].w === w).sort((a, b) => a - b); if (!ids.length) return "";
        const all = L.filter(d => d.w === w).length, wn = (DATA.worlds.find(o => o.id === w) || {}).name || w;
        return `<p class="desc"><b>${wn}</b> · 已发现 ${ids.length} / ${all}</p>` + ids.map(i => this.mjRow(i, "ld")).join("");
      }).join("");
      return `<div class="card"><h3>${this.mjLabel("ld")}<small>已发现 ${m.found.filter(i => L[i]).length} / ${L.length}</small></h3>
        ${groups || `<p class="desc">还没有发现灵地。在仙界、冥界、魔界、神界的地图历练、自动探索时，有几率探得灵地消息。</p>`}
        ${m.found.length ? `<div class="btns"><button class="primary" onclick="G.mjAll('ld')" ${ready ? "" : "disabled"}>一键探索（${ready} 处）</button></div>` : ""}</div>`;
    },
    setExploreOpen(v) { this.exploreOpen = v; this.render(); },
    // 探索信息一行：战斗事件后面带「详情」按钮
    evLine(e, src, i) { return `<p class="${e.c}"><b>第${e.n}步</b> ${e.t}${e.b ? ` <button class="sm" onclick="G.showBattle('${src}',${i})">详情</button>` : ""}</p>`; },
    setLastOpen(v) { this.lastOpen = v; this.render(); },
    // v205 全部探索记录：最近 10 次（新的在前），含战斗回放
    exHistAdd(r) {
      const s = this.s, h = s.exHist || (s.exHist = []);
      h.unshift({ title: r.title, bad: !!r.bad, ev: r.ev.slice() });
      if (h.length > 10) h.length = 10;
    },
    openExHist(k) {
      if (k !== undefined) this.exHistSel = this.exHistSel === k ? -1 : k;
      const h = this.s.exHist || [], sel = this.exHistSel;
      this.modal(`<h2>全部探索<small style="color:#8c7e66;font-size:12px;margin-left:6px">最近 ${h.length} 次</small></h2>
        ${h.length ? h.map((r, i) => `<div class="line" style="align-items:center"><div class="${r.bad ? "q5" : ""}" style="font-size:13px">${i + 1}. ${r.title}</div><button class="sm ${sel === i ? "on" : ""}" style="flex-shrink:0" onclick="G.openExHist(${i})">${sel === i ? "收起" : "详细"}</button></div>
          ${sel === i ? `<div class="explore-log">${r.ev.map((e, j) => this.evLine(e, "h" + i, j)).join("")}</div>` : ""}`).join("") : "<p>还没有探索记录。</p>"}
        <div class="btns"><button onclick="G.closeModal()">关闭</button></div>`);
    },
    setMapSel(a) { this.mapSel = a; this.render(); },   // a = 地图序号，"mj" = 秘境

    /* ---------- 坊市：丹药 装备 功法 药材 矿石 ----------
     * 丹药、装备：content/items.js 的 ITEMS.shop，只卖练气品质
     * 功法：凡界坊市功法（config/gongfa.js 的 shop），灵石购买，买下即学会第 1 层
     * 药材、矿石：凡界地图会掉的（config/drops.js），售价 = 出售价 × CFG.price.SHOP_MAT */
    setShopTab(t) { this.shopTab = t; this.render(); },
    setShopStar(n) { this.shopStar = n; this.render(); },
    shopList() {
      const g = 0, list = [];   // 只卖练气品质
      const src = ITEMS.shop || [...Object.keys(DATA.pills).map(t => ({ kind: "pill", type: t })), ...DATA.eqSlots6.map(sl => ({ kind: "eq", slot: sl }))];
      for (const x of src) {
        if (!x || (x.realm !== undefined && this.r() < x.realm)) continue;
        if (x.kind === "pill" && DATA.pills[x.type]) list.push({ kind: "pill", type: x.type, g, price: x.price || DATA.pillPrice(x.type, g), tab: "pill" });
        else if (x.kind === "eq" && DATA.eqSlots6.includes(x.slot)) list.push({ kind: "eq", slot: x.slot, price: x.price || Math.floor(CFG.price.SHOP_EQUIP), tab: "eq" });
      }
      return list;
    },
    buy(i, n = 1) {
      const it = this.shopList()[i]; if (!it) return;
      let k = 0;
      for (; k < n; k++) {
        if (this.s.stone < it.price) { this.log("灵石不足。", "sys"); break; }
        const ok = it.kind === "pill" ? this.addPill(it.type, it.g) : this.addEquip(DATA.rollForged(it.slot, 0)); // 头盔~吊坠：一阶炼器装备（随机属性）
        if (!ok) break;
        this.s.stone -= it.price;
      }
      if (k) this.log(`购买成功 ×${k}。`, "good");
      this.after();
    },
    // 坊市药材、矿石
    shopMatPrice(kind, g) { return Math.max(1, Math.ceil(DATA.matPrice(kind, g) * (CFG.price.SHOP_MAT || 3))); },
    buyMat(kind, g, n) {
      n = Math.floor(n || +($("#shop-n") && $("#shop-n").value) || 1);
      const names = kind === "herb" ? DATA.herbs : DATA.ores;
      if (n <= 0 || !DATA.fanMats().has(names[g])) return;
      const c = this.shopMatPrice(kind, g) * n;
      if (this.s.stone < c) return this.log(`灵石不足，需要 ${U.fmt(c)}。`, "sys");
      if (!this.addMat(kind, names[g], g, n)) return;
      this.s.stone -= c; this.shopN = n;
      this.log(`购买${DATA.matFull(kind, g)} ×${U.fmt(n)}，灵石 -${U.fmt(c)}。`, "good"); this.after();
    },
    // 坊市功法：买下即学会第 1 层
    buyGongfa(id) {
      const g = DATA.skillInfo(id);
      if (!g || g.src !== "shop" || this.hasGongfa(id)) return;
      if (!this.realmOK(g.sect.reqRealm)) return this.log(`境界不足，需要${DATA.realmLabel(g.sect.reqRealm)}。`, "sys");
      if (this.s.stone < g.cost) return this.log("灵石不足。", "sys");
      if (!this.lqCan("gf", id)) return;   // v173 学习队列
      if (!this.lsCheck(id)) return;   // 神识（shenshi.js）
      this.s.stone -= g.cost; this.startGfLearn(id); this.after();
    },
    // 仙魔冥神坊市 / 功德司功法：坊市 = 灵石 + 本图贡献，功德司 = 功德
    learnJieGf(id) {
      const g = DATA.skillInfo(id), s = this.s;
      if (!g || (g.src !== "jshop" && g.src !== "gd") || this.hasGongfa(id)) return;
      if (!this.realmOK(g.sect.reqRealm)) return this.log(`境界不足，需要${DATA.realmLabel(g.sect.reqRealm)}。`, "sys");
      if (!this.lqCan("gf", id)) return;   // v173 学习队列
      if (!this.lsCheck(id)) return;   // 神识（shenshi.js）
      if (g.src === "gd") { if ((s.merit || 0) < g.cost) return this.log("功德不足。", "sys"); s.merit -= g.cost; }
      else {
        if (s.stone < g.cost) return this.log("灵石不足。", "sys");
        if (this.xjGxOf(g.sect.map) < g.gx) return this.log("本图贡献不足。", "sys");
        s.stone -= g.cost; this.xjGxAdd(g.sect.map, -g.gx);
      }
      this.startGfLearn(id); this.after();
    },
    // 功德司上古丹：本界第 i 张图卖 i 阶（config/alchemy.js 的 SHANGGU）
    sgDanList(a) {
      const S = CFG.alchemy.SHANGGU || {}, w = DATA.maps[a].w, cat = (S.WORLD_CAT || {})[w], g = (DATA.worldMapIdx[w] || []).indexOf(a);
      if (!cat || g < 0) return [];
      return Object.keys(DATA.dans).filter(t => DATA.danCat(t) === cat && CFG.alchemy.recipes[t].val[g] !== undefined).map(type => ({ type, g, cost: (S.MERIT || [])[g] || 0 }));
    },
    buySgDan(a, type, n) {
      const s = this.s, o = DATA.jieGfOf("gd", a), d = this.sgDanList(a).find(x => x.type === type); if (!o || !d) return;
      if (!this.realmOK(o.reqRealm)) return this.log(`境界不足，需要${DATA.realmLabel(o.reqRealm)}。`, "sys");
      n = Math.min(n, Math.floor((s.merit || 0) / d.cost)); if (n <= 0) return this.log("功德不足。", "sys");
      if (!this.addDan(type, d.g, n, 1)) return;
      s.merit -= d.cost * n; this.log(`购得${DATA.danName(type, d.g, 1)} ×${n}。`, "good"); this.after();
    },
    jieGfView(kind, a) {
      const s = this.s, o = DATA.jieGfOf(kind, a); if (!o) return "";
      const lock = !this.realmOK(o.reqRealm), gd = kind === "gd";
      const rows = U.doneLast(DATA.gfTypesOf(o.src).map(ty => { const g = DATA.gongfaInfo(DATA.gongfaId(o.id, ty.id)), has = this.hasGongfa(g.id);
        const poor = gd ? (s.merit || 0) < g.cost : s.stone < g.cost || this.xjGxOf(a) < g.gx;
        return [has, `<div class="line"><div>${DATA.skillIco(g)}《${g.name}》<span class="tag">${g.star}星</span><span class="tag">${g.el.name}</span><span class="tag">${ty.name}</span><small>每层${g.label} +${U.num(g.perLv)}${g.label2 ? ` · ${g.label2} +${U.num(g.perLv2)}` : ""} · ${gd ? `${U.fmt(g.cost)} 功德` : `${U.fmt(g.cost)} 灵石 · ${U.fmt(g.gx)} 贡献`} · 学习 ${U.dur(DATA.gfLearnMin(g.star) * 60)}</small></div>
          ${lock && !has ? `<button class="sm" disabled>境界不足</button>` : this.gfLearnBtn(g, `G.learnJieGf('${g.id}')`, poor)}</div>`]; }));
      const dans = gd ? this.sgDanList(a).map(d => { const r = DATA.dans[d.type], poor = (s.merit || 0) < d.cost;
        return `<div class="line"><div>${DATA.danImg(DATA.danIcon(d.type), DATA.danCls(d.type, d.g), "mi")}${DATA.danName(d.type, d.g, 1)}<small>永久${r.label} +${U.num(DATA.danVal(d.type, d.g))} · 已服 ${DATA.danLimit(d.type, d.g) - this.danLeft(d.type, d.g)} / ${DATA.danLimit(d.type, d.g)} · ${U.fmt(d.cost)} 功德</small></div>
          ${lock ? `<button class="sm" disabled>境界不足</button>` : `<div class="sg-btns"><button class="sm" onclick="G.buySgDan(${a},'${d.type}',1)" ${poor ? "disabled" : ""}>购买</button><button class="sm" onclick="G.buySgDan(${a},'${d.type}',10)" ${poor ? "disabled" : ""}>×10</button></div>`}</div>`; }).join("") : "";
      const fruit = gd ? (c => `<div class="card"><h3>${DATA.smName("wdg")}</h3><div class="line"><div>${DATA.li(DATA.smIcon("wdg"))}${DATA.smName("wdg")}<small>洞府悟道室悟道用 · ${c} 功德/个 · 已有 ${U.fmt(this.smCount("wdg"))}</small></div>
        <div class="sg-btns"><button class="sm" onclick="G.buyWdFruit(1)" ${(s.merit || 0) < c ? "disabled" : ""}>购买</button><button class="sm" onclick="G.buyWdFruit(10)" ${(s.merit || 0) < c * 10 ? "disabled" : ""}>×10</button></div></div></div>`)(CFG.wudaoRoom.FRUIT_MERIT) : "";
      return this.lqCard("gf") + fruit + `<div class="card"><h3>${o.name}<small>${gd ? `功德 ${U.fmt(s.merit || 0)}` : `灵石 ${U.fmt(s.stone)} · 本图贡献 ${U.fmt(this.xjGxOf(a))}`}</small></h3>${rows}</div>${dans ? `<div class="card"><h3>上古丹</h3>${dans}</div>` : ""}`;
    },
    // 管理员：网页里更新游戏（服务器拉取 GitHub 最新代码，完成后刷新页面）
    async webUpdate() {
      if (this.updating || !confirm("从 GitHub 拉取最新代码并重启存档服务？（会先同步一次存档）")) return;
      this.updating = true; this.render();
      try { await this.save(true); } catch (e) {}
      try { await API.adminUpdate(); } catch (e) { this.updating = false; this.log("更新失败：" + e.message, "bad"); return this.render(); }
      const t0 = Date.now(), poll = async () => {
        try { const j = await API.adminInfo(); this.adminInfo = j;
          if (/更新完成|失败|error/i.test(j.log || "") && Date.now() - t0 > 3000) { this.updating = false; this.log(/更新完成/.test(j.log) ? "游戏已更新，点「刷新页面」载入新版本。" : "更新出错，看下面的输出。", /更新完成/.test(j.log) ? "gold" : "bad"); return this.render(); }
        } catch (e) {}   // 存档服务重启的几秒连不上，继续等
        if (Date.now() - t0 > 120000) { this.updating = false; this.log("等待超时，稍后刷新页面看看。", "bad"); return this.render(); }
        this.render(); setTimeout(poll, 3000);
      };
      setTimeout(poll, 3000);
    },
    shopView() {
      const s = this.s, t = this.shopTab || "pill";
      const tabs = `<div class="sub-tabs">${[["pill", "丹药"], ["eq", "装备"], ["gf", "功法"], ["herb", DATA.matKinds.herb], ["ore", DATA.matKinds.ore]].map(([k, n]) =>
        `<button class="${t === k ? "active" : ""}" onclick="G.setShopTab('${k}')">${n}</button>`).join("")}</div>`;
      if (t === "pill" || t === "eq") {
        const rows = this.shopList().map((it, i) => {
          if (it.tab !== t) return "";
          const multi = it.kind === "pill";
          const name = it.kind === "pill" ? `${DATA.realms[it.g]}·${DATA.pills[it.type].name}` : DATA.forgeEqName(it.slot, 0);
          const desc = it.kind === "pill" ? `修炼速度 +${Math.round(DATA.pillPct(it.type, it.g))}%，${DATA.pills[it.type].dur}次修炼` : `${DATA.slots[it.slot]} · 2 条主属性 + 1~5 条附加属性（颜色随机）`;
          const img = it.kind === "pill" ? DATA.pillIcon(it.type) : DATA.iconImg("eq_" + it.slot);
          return `<div class="line"><div>${DATA.li(img)}${name}<small>${desc}</small></div><div>
            <button class="sm" onclick="G.buy(${i})" ${s.stone < it.price ? "disabled" : ""}>${U.fmt(it.price)}</button>
            ${multi ? `<button class="sm" onclick="G.buy(${i},10)" ${s.stone < it.price * 10 ? "disabled" : ""}>×10</button>` : ""}</div></div>`;
        }).join("");
        return tabs + `<div class="card"><h3>${t === "pill" ? "丹药" : "装备"}<small>练气期货品 · 灵石 ${U.fmt(s.stone)}</small></h3>${rows || `<p class="desc">暂无货品。</p>`}</div>`;
      }
      if (t === "gf") {
        const star = this.shopStar || 1, N = DATA.SHOP_GF_PREFIX.length;
        const srcs = DATA.shopSources.filter(o => o.star === star), lock = !this.realmOK(srcs[0] ? srcs[0].reqRealm : 0);
        const line = g => { const has = this.hasGongfa(g.id);
          const desc = g.kind === "sp" ? `${g.el.name}系 · ${this.spellDmgTxt(g)} · 耗法力 ${U.fmt(g.mana)}` : `每层${g.label} +${U.num(g.perLv)}${g.label2 ? ` · ${g.label2} +${U.num(g.perLv2)}` : ""}`;
          return [has, `<div class="line"><div>${DATA.skillIco(g)}《${g.name}》<span class="tag">${g.star}星</span><span class="tag">${g.kind === "sp" ? "法术" : g.type.name}</span><small>${desc} · ${U.fmt(g.cost)} 灵石 · 学习 ${U.dur(DATA.gfLearnMin(g.star) * 60)}</small></div>
            ${lock && !has ? `<button class="sm" disabled>境界不足</button>` : this.gfLearnBtn(g, `G.buyGongfa('${g.id}')`, s.stone < g.cost)}</div>`]; };
        return tabs + this.lqCard("gf") + `<div class="room-grid">${Array.from({ length: N }, (_, i) => `<button class="${star === i + 1 ? "active" : ""}" onclick="G.setShopStar(${i + 1})">${i + 1}星</button>`).join("")}</div>` +
          U.doneCards(srcs.map(o => ({ head: `<h3>${o.name}<span class="tag">${DATA.elById[o.el].name}</span></h3>`,
            rows: DATA.gfTypesOf("shop").filter(ty => !ty.sectOnly).map(ty => line(DATA.gongfaInfo(DATA.gongfaId(o.id, ty.id))))
              .concat([line(DATA.spellInfo(DATA.spellId(o.id, o.el)))]) })));
      }
      const names = t === "herb" ? DATA.herbs : DATA.ores, fan = DATA.fanMats();
      return tabs + `<div class="card"><h3>${DATA.matKinds[t]}<small>凡界地图产出 · 灵石 ${U.fmt(s.stone)}</small></h3>
        <div class="line"><div>购买数量</div><input id="shop-n" type="number" min="1" value="${this.shopN || 1}" oninput="G.shopN=+this.value" style="width:110px"></div>` +
        names.map((n, g) => { if (!fan.has(n)) return ""; const c = this.shopMatPrice(t, g);
          return `<div class="line"><div>${DATA.li(DATA.matImg(t, g))}${DATA.matFull(t, g)}<small>${U.fmt(c)} 灵石/个 · 已有 ${U.fmt(this.countMat(t, g))}</small></div>
            <button class="sm" onclick="G.buyMat('${t}',${g})" ${s.stone < c ? "disabled" : ""}>购买</button></div>`; }).join("") + `</div>`;
    },
  },

  view() {
    const s = this.s, wid = this.worldId || "fan", wt = wid === "fan" ? this.worldTab || "explore" : "explore";   // v47：仙冥魔神没有 历练/坊市/设置 页签
    // 六界选择
    const worlds = `<div class="room-grid">${DATA.worlds.map(w =>
      `<button class="${wid === w.id ? "active" : ""}" onclick="G.setWorld('${w.id}')">${w.name}${this.worldOpen(w.id) || (CFG.worldMaps || {})[w.id] ? "" : "<small>未开放</small>"}</button>`).join("")}<button onclick="G.log('机缘暂未开放，敬请期待。','sys')">机缘<small>未开放</small></button></div>`;   // 机缘：先只有按钮
    const W = DATA.worlds.find(w => w.id === wid);
    if (!this.worldOpen(wid)) return worlds + `<div class="card"><h3>${W.name}</h3><p class="desc">${W.desc}</p>${(CFG.worldMaps || {})[wid] ? "" : `<p class="desc">界壁未开，以你如今的修为尚无法踏足。</p>`}</div>`;
    const tabs = wid !== "fan" ? worlds : worlds + `<div class="sub-tabs">
      <button class="${wt === "explore" ? "active" : ""}" onclick="G.setWorldTab('explore')">${DATA.nmPick(CFG.names.worldTab, "explore", "历练")}</button>
      <button class="${wt === "shop" ? "active" : ""}" onclick="G.setWorldTab('shop')">${DATA.nmPick(CFG.names.worldTab, "shop", "坊市")}</button>
      <button class="${wt === "battle" ? "active" : ""}" onclick="G.setWorldTab('battle')">战斗</button>
      <button class="${wt === "set" ? "active" : ""}" onclick="G.setWorldTab('set')">设置</button></div>`;

    if (wt === "explore") {
      const st = this.stats();
      const bars = `<div class="row small"><span>生命 ${U.fmt(s.hp)} / ${U.fmt(st.hp)}</span><span>斩妖 ${s.kills}</span></div>
        <div class="bar hp"><div style="width:${s.hp / st.hp * 100}%"></div></div>
        <div class="row small"><span>法力 ${U.fmt(s.mana)} / ${U.fmt(st.mana)}</span><span>灵石 ${U.fmt(s.stone)}</span></div>`;
      const status = (() => s.explore ? (() => { const x = s.explore, T = this.exCfg(x).TIME, L = x.loot;
          const mats = Object.values(L.mats).map(m => `${m.name}×${U.fmt(m.n)}`);
          if (L.hx) mats.push(`${DATA.HX}×${U.fmt(L.hx)}`);
          for (const k in L.sm || {}) { const p = DATA.smParse(k); mats.push(`${DATA.smName(p.k, p.ft, p.tier)}×${U.fmt(L.sm[k])}`); }
          for (const n in L.cu || {}) mats.push(`${n}×${U.fmt(L.cu[n])}`);
          const sub = x.mj !== undefined ? (x.once ? "" : x.queue && x.queue.length ? `一键探索 · 后面还有 ${x.queue.length} 处` : this.mjLabel(x.mk) + "探索") : x.once ? "" : x.cq ? `已完成 ${x.count} / ${x.cq} 次` : `已完成 ${x.count} 次`, hpP = Math.min(100, s.hp / this.stats().hp * 100), mpP = Math.min(100, s.mana / Math.max(1, this.stats().mana) * 100), bg = this.bsetGet(), gH = Math.min(100, bg.goHp || 0), gM = Math.min(100, bg.goMp || 0), restP = Math.min(gH > 0 ? hpP / gH : 1, gM > 0 ? mpP / gM : 1) * 100;   // v202 休养进度 = 生命、法力离「继续探索」设置还差多少
          return `<div class="card"><h3>${x.once ? "历练中" : x.cq ? "出窍探索中" : "自动探索中"} · ${this.exName(x)}<small>${sub}</small></h3>
          <div class="bar tick"><div style="width:${x.rest ? Math.min(100, restP) : x.step / T * 100}%"></div></div>
          <div class="row small" style="align-items:center"><span>${x.rest ? `<b class="c-red">休养中</b> · 生命 ${U.fix(Math.floor(hpP) + "%")} / <b class="c-green">${gH}%</b><br><b class="c-red">休养中</b> · 法力 ${U.fix(Math.floor(mpP) + "%")} / <b class="c-green">${gM}%</b>` : x.step >= T ? `第 ${U.fix(T)} / ${T} 步 · 结算中` : `第 ${U.fix(x.step)} / ${T} 步 · 剩余 ${U.cd(Math.ceil((T - x.step) * (x.ms || 1000) / 1000 + (CFG.explore.END_WAIT || 0)))}`}</span><span style="white-space:nowrap;flex-shrink:0">
            <button class="sm" onclick="G.setExploreOpen(${!this.exploreOpen})">${this.exploreOpen ? "收起信息" : "探索信息"}</button>
            <button class="sm" onclick="G.stopNow()">停止</button></span></div>
          <p class="desc">本次收获（结束后放入背包）：灵石 ${U.fmt(L.stone)}${mats.length ? "、" + mats.join("、") : ""}</p>
          ${this.exploreOpen ? `<div class="btns" style="margin-top:6px"><button class="sm on">当前探索</button><button class="sm" onclick="G.openExHist()">全部探索</button></div><div class="explore-log">${x.ev.map((e, i) => this.evLine(e, "cur", i)).join("") || "<p>出发……</p>"}</div>` : ""}</div>`; })()
        : s.lastRun ? `<div class="card"><h3>本次结果<small><button class="sm" onclick="G.setLastOpen(${!this.lastOpen})">${this.lastOpen ? "收起" : "详细"}</button></small></h3>
          <p class="desc ${s.lastRun.bad ? "q5" : ""}">${s.lastRun.title}</p>
          ${this.lastOpen ? `<div class="explore-log">${s.lastRun.ev.map((e, i) => this.evLine(e, "last", i)).join("")}</div>` : ""}</div>` : "")();
      // 地图选择（9 张）+ 选中地图的 东西南北 四个区域
      // v45：只列当前这一界的 9 张地图；秘境只在凡界
      const idx = (DATA.worldMapIdx[wid] || []).slice().sort((a, b) => DATA.mapReq(a) - DATA.mapReq(b) || a - b), fan = wid === "fan";   // 从低到高
      const ex = s.explore ? (s.explore.mj !== undefined ? (fan && s.explore.mk !== "ld" ? "mj" : undefined) : idx.includes(s.explore.map) ? s.explore.map : undefined) : undefined;
      const ok = idx.filter(a => this.mapOpen(a));
      const sel = this.mapSel !== undefined && (this.mapSel === "mj" ? fan : idx.includes(this.mapSel)) ? this.mapSel : ex !== undefined ? ex : ok.length ? ok[ok.length - 1] : idx[0];
      const grid = `<div class="room-grid five">${idx.map(a => { const m = DATA.maps[a]; return `<button class="${sel === a ? "active" : ""}" onclick="G.setMapSel(${a})">${m.name}${!this.realmOK(DATA.mapReq(a)) ? `<small>需${DATA.realmLabel(DATA.mapReq(a))}</small>` : !this.mapUnlocked(a) ? `<small>未开启</small>` : ""}</button>`; }).join("")}
            ${fan ? `<button class="${sel === "mj" ? "active" : ""}" onclick="G.setMapSel('mj')">${this.mjLabel("mj")}<small>${this.mjState().found.length ? `已发现 ${this.mjState().found.length} 处` : "未发现"}</small></button>` : ""}</div>`;
      const halls = ((CFG.worldMaps || {})[wid] || {}).halls;
      if (halls && sel !== "mj") {
        // v49：仙冥魔神每张地图 7 处地点（config/worldmaps.js 的 halls，图片 img/hall_<id>.png），点进去是各自的页面
        const hn = id => (halls[id] || "").replace("{map}", DATA.maps[sel].name), hs = halls[this.hallSel] ? this.hallSel : null;
        if (hs) {
          const back = `<div class="row" style="margin:6px 0"><b>${DATA.maps[sel].name} · ${hn(hs)}</b><button class="sm" onclick="G.setHall(null)">返回</button></div>`;
          const page = hs === "tg" ? this.tgView(sel) : hs === "xj" ? this.xjView(sel)
            : hs === "lilian" ? bars + status + this.regionsCard(sel) : hs === "lingdi" ? bars + status + this.lingdiView()
            : hs === "shop" || hs === "gd" ? this.jieGfView(hs === "gd" ? "gd" : "jshop", sel) : `<div class="card"><h3>${hn(hs)}</h3></div>`;
          return tabs + back + page;
        }
        const ico = (id, cls) => halls[id] === undefined ? "" : `<button class="${cls || ""}" onclick="G.setHall('${id}')"><img src="img/hall_${id}.png" alt=""><span>${hn(id)}</span></button>`;
        const gxTag = this.xjGxOf ? `<div class="xs-gx">贡献<b>${U.fmt(this.xjGxOf(sel))}</b></div>` : "";   // 本图贡献：显示在天宫图片左边
        return tabs + grid + `<div class="xscene xs-${wid}"><div class="tgrow">${gxTag}${ico("tg", "tg")}</div>${["xj", "gd", "shop", "lilian", "wudao", "lingdi"].map(id => ico(id)).join("")}</div>`;
      }
      return tabs + bars + status + grid + (sel === "mj" ? this.mijingView() : this.regionsCard(sel));
    }
    if (wt === "shop") return tabs + this.shopView();
    if (wt === "battle") return tabs + this.bsetView();

    if (this.giftPage && this.adminInfo && this.adminInfo.admin) return tabs + this.giftAdminView();
    if (this.accPage && this.adminInfo && this.adminInfo.admin) return tabs + this.accAdminView();
    if (this.adminInfo === undefined) { this.adminInfo = null; API.adminInfo().then(j => { this.adminInfo = j; this.render(); }).catch(() => {}); }
    const A = this.adminInfo, upd = A && A.admin ? `<div class="card"><h3>游戏更新<small>管理员</small></h3>
      <p class="desc">当前版本：${A.version || "未知"}</p>
      <div class="btns"><button class="primary" onclick="G.webUpdate()" ${this.updating ? "disabled" : ""}>${this.updating ? "更新中…" : "从 GitHub 更新"}</button>
      <button onclick="location.reload()">刷新页面</button></div>
      ${A.log ? `<div class="explore-log" style="white-space:pre-wrap;font-size:11px">${A.log.replace(/</g, "&lt;")}</div>` : ""}</div>
      <div class="card"><h3>礼包码<small>管理员</small></h3><div class="btns"><button class="primary" onclick="G.openGiftAdmin(true)">生成礼包码</button></div></div>
      <div class="card"><h3>账号管理<small>管理员</small></h3><div class="btns"><button class="primary" onclick="G.openAccAdmin(true)">账号管理</button></div></div>` : "";
    return tabs + upd + this.giftRedeemCard() + `<div class="card"><h3>账号<small>${API.user}</small></h3>
      <p class="desc">存档保存在服务器，换手机、关浏览器都不会丢。离线期间修炼、聚灵阵持续进行，不封顶。</p>
      <div class="btns"><button onclick="G.save(true)">立即同步</button><button onclick="G.openPwForm(true)">修改密码</button><button onclick="G.logout()">退出登录</button>
      <button onclick="G.restart()">删档重来</button></div>${this.pwFormView()}</div>`;
  },
});
