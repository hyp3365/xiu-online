/* =====================================================================
 * 模块：人物（境界、属性、生命法力自动恢复）
 * 开局为“凡人”，修为满 100 突破为练气期一层。
 * ---------------------------------------------------------------------
 * 属性计算公式（computeStats）：
 *   生命 = 凡人基础 + 修为突破合计 + 装备 + 真经
 *   攻击 =  凡人基础 + 修为突破合计 + 装备 + 功诀
 *   防御 =  凡人基础 + 修为突破合计 + 装备 + 心法
 *   法力 =  凡人基础 + 修为突破合计 + 装备 + 法诀
 *   （功法加成都是固定数值；以上各项再加 属性丹 永久加成）
 *   基础修炼速度 = 凡人基础 + 修为突破合计（不显示为属性）
 *   速度 = 凡人基础 + 修为突破合计 + 装备
 *   命中 = 凡人基础 + 修为突破合计 + 装备 + 身法 + 丹药；闪避 = 凡人基础 + 修为突破合计 + 装备 + 遁术 + 丹药
 *   暴击：固定基础值 + 装备 + 丹药，不随境界成长
 *   抗性（金木水火土雷各一）= RES_BASE + 修为突破合计 + 本系真诀；法术伤害按 防御 + 对应抗性 抵消
 * ===================================================================== */
G.module({
  id: "player",

  defaults: () => ({
    mortal: true, // 凡人（尚未踏入练气期）
    L: 0,        // 总层序（境界×10+层）
    exp: 0,      // 当前修为
    hp: CFG.player.base.hp,     // 当前生命
    mana: CFG.player.base.mana, // 当前法力
    kills: 0,    // 斩妖数
  }),

  // 每 10 秒：生命、法力各恢复上限的 1%
  tick() {
    const st = this.stats(), s = this.s;
    const R = this.regen(false);   // 平时恢复：每 10 秒 % 上限
    if (s.hp < st.hp) s.hp = Math.min(st.hp, s.hp + st.hp * R.hp / 100);
    if (s.mana < st.mana) s.mana = Math.min(st.mana, s.mana + st.mana * R.mana / 100);
  },

  api: {
    r() { return Math.floor(this.s.L / DATA.LAYERS); },          // 当前大境界序号
    layer() { return this.s.L % DATA.LAYERS; },
    // 境界够不够：req = -1 凡人即可，否则需要（非凡人且）大境界 ≥ req
    realmOK(req) { return req < 0 || (!this.s.mortal && this.r() >= req); },                    // 当前层（0~9）
    needExp() { return this.s.mortal ? DATA.MORTAL_EXP : DATA.needExp(this.s.L); },
    realmName(L) {
      if (L === undefined) { if (this.s.mortal) return "凡人"; L = this.s.L; }
      return DATA.realmLabel(Math.floor(L / 10)) + DATA.layerNames[L % 10];
    },

    // 汇总装备加成
    equipTotal() {
      const add = { atk: 0, hp: 0, def: 0, mana: 0, crit: 0, hit: 0, dodge: 0, speed: 0 };
      const all = [...Object.values(this.s.equip), ...this.s.fabao.slice(0, this.slotCount())]; // 装备 + 法宝
      for (const e of all) if (e) {
        const st = this.equipStats(e);
        for (const k in st) if (k in add) add[k] += st[k];
      }
      return add;
    },

    // 历练/探索每走一步恢复的百分比 = config/explore.js HEAL_STEP + 宗门秘法「斗血 / 斗灵」（战斗中途不再恢复）
    regenStep() {
      const m = this.mifaBonus(), H = (CFG.explore.HEAL_STEP || 0) * 100;
      // hp / mana = 恢复上限的 %（HEAL_STEP + 斗血 / 斗灵圆满额外 %），hpFlat / manaFlat = 斗血 / 斗灵每步固定点数
      return { hp: H + (m.hpBattlePct || 0), mana: H + (m.mpBattlePct || 0), hpFlat: m.hpBattle || 0, manaFlat: m.mpBattle || 0 };
    },
    // 恢复百分比：battle = true 雷劫中每回合（秘法），false 平时每 10 秒（config/player.js + 宗门秘法）
    regen(battle) {
      const m = this.mifaBonus();
      if (battle) return { hp: m.hpBattlePct || 0, mana: m.mpBattlePct || 0, hpFlat: m.hpBattle || 0, manaFlat: m.mpBattle || 0 };   // 战斗中只有秘法恢复
      const b = CFG.player.REGEN_IDLE || {};
      if (this.inFight()) return { hp: 0, mana: 0 };   // v201 战斗进行中（历练 / 探索 / 出窍 / 秘境 / 灵地 / 渡劫，休养不算）：平时恢复 1% 和 养血 / 养灵都不生效，只靠 斗血 / 斗灵
      return { hp: (b.hp || 0) + m.hpIdle, mana: (b.mana || 0) + m.mpIdle };
    },
    // 战斗进行中：历练 / 探索 / 出窍 / 秘境 / 灵地（休养等待时不算），或正在渡劫
    inFight() {
      const s = this.s, x = s.explore;
      return !!((x && !x.rest) || (s.trib && !s.trib.result));
    },
    computeStats() {
      const L = this.s.mortal ? -1 : this.s.L, F = DATA.playerFixed, R = k => DATA.realmStat(L, k);   // 修为突破属性（config/realm.js 的 GAIN）
      const eq = this.equipTotal(), gf = this.gongfaBonus(), dn0 = this.danBonus();
      const dn = {}; for (const k of ["hp", "atk", "def", "mana", "hit", "dodge", "crit"]) dn[k] = dn0[k] || 0; // 属性丹；gongfaBonus 见 gongfa.js，danBonus（属性丹）见 craft.js
      const bd = this.bodyBonus ? this.bodyBonus() : {}; for (const k of ["hp", "atk", "def", "mana", "hit", "dodge", "crit"]) dn[k] += bd[k] || 0;   // 肉身突破加成（body.js）
      return {
        hp:      R("hp") + eq.hp + gf.hp + dn.hp,
        atk:     R("atk") + eq.atk + gf.atk + dn.atk,
        def:     R("def") + eq.def + gf.def + dn.def,
        mana:    R("mana") + eq.mana + gf.mana + dn.mana,
        cultivate: R("cultivate"),
        speed:   R("speed") + eq.speed + gf.speed + (bd.speed || 0) + (dn0.speed || 0),
        hit:     R("hit") + eq.hit + gf.hit + dn.hit,
        dodge:   R("dodge") + eq.dodge + gf.dodge + dn.dodge,
        crit:    Math.min(DATA.CRIT_CAP, F.crit + eq.crit + dn.crit),
        res:     Object.fromEntries(DATA.elements.map(e => [e.id, R("res") + (gf.res[e.id] || 0) + (bd.res || 0) + (dn0.res || 0)])),
      };
    },
  },
});
