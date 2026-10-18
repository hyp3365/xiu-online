/* =====================================================================
 * 怪物属性生成（数值在 config/mobs.js）
 * 每个怪物 8 个数 [进入境界, 境界, 层, 功法星级, [1, 宗门%, 宗门层], [2, 坊市%, 坊市层], [3, 功德司%, 功德司层], 倍率]：
 *   怪物基础属性 = (修为突破属性 + 肉身突破属性 + 功法属性) × 倍率
 *   遇到时 × 随机(RAND[0] ~ RAND[1])；暴击 = CRIT
 *   旧写法（v218 的 9 个数、更早的 8 个数）仍能读
 * 生成后写进：
 *   CFG.monster.regions[地图][区域][normal/elite/boss]、CFG.monster.MAP_REALM（凡界 + 仙魔冥神）
 *   CFG.mijing.list[i] / CFG.lingdi.list[i] 的 realm 和 normal/elite/boss
 *   天将 / 星君 / 界主、宗门考官用 DATA.mobTj / mobXj / mobJz / mobExam 现取
 * ===================================================================== */
DATA.MOB_KIND = { normal: "普通", elite: "精英", boss: "首领" };
DATA.MOB_KEYS = ["hp", "atk", "def", "speed", "hit", "dodge", "mana", "res"];
// 遇到时的随机倍率
// v180 RAND 每种属性单独：{ atk: [a, b], hp: [a, b], 其他: [a, b] }
DATA.mobRandOf = k => { const R = CFG.mobs.RAND; return R[k] || R["其他"]; };
DATA.mobRnd = k => { const R = DATA.mobRandOf(k); return R[0] + Math.random() * (R[1] - R[0]); };
// 肉身突破 n 次的合计加成（同 modules/body.js bodyBonus）
DATA.mobBody = n => { const o = {}; for (const k of DATA.MOB_KEYS) o[k] = DATA.bodyStat(n, k); return o; };
// 怪物功法的三类来源（悟道、试炼塔、宗门传承功法怪物不算）
//   1 宗门功法（宗门功法殿，不含传承功法）  2 坊市功法（凡阶坊市 + 四界坊市）  3 四界功德司功法
DATA.MOB_GF_CAT = { 1: "宗门功法", 2: "坊市功法", 3: "功德司功法" };
DATA.mobCatSrcs = c => c === 1 ? DATA.sects : c === 2 ? [...DATA.shopSources, ...((DATA.jieGf || {}).jshop || [])] : c === 3 ? (DATA.jieGf || {}).gd || [] : [];
// v219 一行怪物数据统一成对象：8 个数 [进入境界, 境界, 层, 功法星级, [1, 宗门%, 宗门层], [2, 坊市%, 坊市层], [3, 功德司%, 功德司层], 倍率]
//   层、各类学%、各类功法层都可以写一个数，或 [最小, 最大]（每次遇到随机；层、功法层取整数，学% 可带小数）
//   cats = [{ c: 1/2/3, pct: [最小, 最大], gf: [最小, 最大] }]，学 0% 或功法层 0 的那类不算
//   兼容：v218 的 9 个数 [.., [1, 宗门%], [2, 坊市%], [3, 功德司%], 功法层, 倍率]；更早的 8 个数 [.., 功法来源, 学功法%, 功法层, 倍率]（只算宗门）
DATA.MOB_NONE = [0, 0, 1, 0, [1, 0, 0], [2, 0, 0], [3, 0, 0], 1];   // 没写时：练气一层、不算功法
DATA.mobRange = v => Array.isArray(v) ? [v[0], v[v.length - 1]] : [v || 0, v || 0];
DATA.mobRow = t => {
  t = t || DATA.MOB_NONE;
  let cats, k;
  if (!Array.isArray(t[4])) { cats = [{ c: 1, pct: t[5], gf: t[6] }]; k = t[7]; }                              // 最早的写法
  else if (t.length >= 9) { cats = [t[4], t[5], t[6]].filter(Array.isArray).map(x => ({ c: x[0], pct: x[1], gf: t[7] })); k = t[8]; }   // v218
  else { cats = [t[4], t[5], t[6]].filter(Array.isArray).map(x => ({ c: x[0], pct: x[1], gf: x[2] })); k = t[7]; }                   // v219
  cats = cats.map(x => ({ c: x.c, pct: DATA.mobRange(x.pct), gf: DATA.mobRange(x.gf) })).filter(x => DATA.MOB_GF_CAT[x.c] && x.pct[1] > 0 && x.gf[1] > 0);
  return { enter: t[0], realm: Math.max(0, Math.min(DATA.realms.length - 1, t[1])), lay: DATA.mobRange(t[2]), star: t[3] || 0,
    cats, k: k === undefined ? 1 : k };
};
// 1 ~ 星级、某一类来源里的全部功法，按种类分组：{ 种类id: [{ id, stat, stat2 }] }（缓存）
DATA._mobBooks = {};
DATA.mobBooks = (realm, star, cat) => {
  const ms = star > 0 ? star : DATA.refStar(realm), key = ms + ":" + cat;
  if (DATA._mobBooks[key]) return DATA._mobBooks[key];
  const o = {};
  for (const sc of DATA.mobCatSrcs(cat)) { if (sc.star > ms) continue;
    for (const t of DATA.gfTypesOf(sc.src)) { if (sc.src === "shop" && t.sectOnly) continue;
      (o[t.id] = o[t.id] || []).push({ id: DATA.gongfaId(sc.id, t.id), stat: t.stat, stat2: t.stat2 }); } }
  return DATA._mobBooks[key] = o;
};
DATA._mobGfv = {};
DATA.mobGfVal = (id, lv) => { const k = id + ":" + lv; if (!(k in DATA._mobGfv)) { const g = lv > 0 ? DATA.gongfaInfo(id, lv) : null; DATA._mobGfv[k] = g ? [g.value || 0, g.value2 || 0] : [0, 0]; } return DATA._mobGfv[k]; };
const _mobRi = r => r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1));
// 算属性：rnd = true 每次遇到随机（层、学%、功法层）；false = 显示用的平均值
DATA.mobCalc = (t, crit, rnd) => {
  const R = DATA.mobRow(t), lay = Math.max(1, Math.min(DATA.LAYERS, rnd ? _mobRi(R.lay) : Math.round((R.lay[0] + R.lay[1]) / 2)));
  const st = DATA.refStats(R.realm, lay, 0, R.star, 1), bd = DATA.mobBody(R.realm * DATA.LAYERS + lay), add = {};
  for (const x of DATA.MOB_KEYS) add[x] = 0;
  for (const C of R.cats) {   // 每类来源各按自己的学% 和功法层算
    const B = DATA.mobBooks(R.realm, R.star, C.c);
    for (const ty in B) {
      // v225 不再随机挑整本：每个种类 = 全部功法 × 学% （1% × 12 本 = 0.12 本的属性），层数按功法层算
      //   遇到时（rnd）：学% 在范围内随机、功法层在范围内随机取整（这一类所有功法同一层）；显示用：学% 取平均、功法层两头平均
      const list = B[ty], f = (rnd ? C.pct[0] + Math.random() * (C.pct[1] - C.pct[0]) : (C.pct[0] + C.pct[1]) / 2) / 100;
      const g0 = rnd ? (C.gl === undefined ? C.gl = _mobRi(C.gf) : C.gl) : C.gf[0], g1 = rnd ? g0 : C.gf[1];
      for (const b of list) { const v0 = DATA.mobGfVal(b.id, g0), v1 = DATA.mobGfVal(b.id, g1);
        if (add[b.stat] !== undefined) add[b.stat] += (v0[0] + v1[0]) / 2 * f; if (b.stat2 && add[b.stat2] !== undefined) add[b.stat2] += (v0[1] + v1[1]) / 2 * f; }
    }
  }
  const o = {};
  for (const x of DATA.MOB_KEYS) o[x] = (st[x] + add[x] + bd[x]) * R.k;
  o.manaBr = st.manaBr;   // 修为突破的法力（法术 / 法宝耗法力用，不乘倍率）
  o.crit = crit || 0; o.layer = lay; o.L = R.realm * DATA.LAYERS + lay - 1;   // v171 总层序（保底伤害用）
  return o;
};
// 显示用（平均值）
DATA.mobStats = (t, crit) => DATA.mobCalc(t, crit, false);
// v168 每次遇到随机：层、学%、功法层（v225 功法按 全部 × 学% 算，不再随机挑书）
DATA.mobRoll = (t, crit) => DATA.mobCalc(t, crit, true);
// 按名字取，名字对不上时按顺序取（地图改了名也不会丢）
DATA.mobPick = (obj, name, i) => { if (!obj) return null; if (obj[name]) return obj[name]; const v = Object.values(obj); return v[i] || null; };
DATA.mobCrit = k => (CFG.mobs.CRIT || {})[k] || 0;
// 一组 {普通, 精英, 首领} → {normal, elite, boss}
DATA.mobGroup = g => { const o = { _t: {} }; for (const k in DATA.MOB_KIND) { const t = (g || {})[DATA.MOB_KIND[k]]; o[k] = DATA.mobStats(t, DATA.mobCrit(DATA.MOB_KIND[k])); o._t[k] = t; } return o; };
// v168 遇到怪物时按这一组的原始数据重新随机（没有原始数据就用算好的）
DATA.mobMeet = (grp, kind) => { const t = grp && grp._t && grp._t[kind]; return t ? DATA.mobRoll(t, DATA.mobCrit(DATA.MOB_KIND[kind])) : grp[kind]; };

// ---------- 凡界 + 仙魔冥神地图 ----------
(() => {
  const M = CFG.mobs;
  for (let a = 0; a < DATA.FAN_MAP_N; a++) {
    const c = DATA.mobPick(M.fan, DATA.maps[a].name, a) || {};
    CFG.monster.regions[a] = DATA.regionDirs.map((n, r) => Object.assign({ name: n, L: a * 10 + (M.FAN_L || [0, 3, 6, 9])[r] }, DATA.mobGroup(c[n])));
    CFG.monster.MAP_REALM[a] = ((c["东"] || {})["普通"] || [0])[0];
  }
  for (const w of ["xian", "ming", "mo", "shen"]) for (const a of DATA.worldMapIdx[w] || []) {
    const m = DATA.maps[a], c = DATA.mobPick(M[w], m.name, m.wi) || {}, R = CFG.monster.regions[a] || [];
    CFG.monster.regions[a] = DATA.regionDirs.map((n, r) => Object.assign({ name: n, L: (R[r] || {}).L || 0 }, DATA.mobGroup(c[n])));
    CFG.monster.MAP_REALM[a] = (c["界主"] || [0])[0];
    m.mob = c;   // 天将 / 星君 / 界主
  }
})();
DATA.mobTj = a => (DATA.maps[a].mob || {})["天将"] || DATA.MOB_NONE;
DATA.mobXj = (a, i) => { const l = (DATA.maps[a].mob || {})["星君"] || []; return l[i] || l[l.length - 1] || DATA.MOB_NONE; };
DATA.mobJz = a => (DATA.maps[a].mob || {})["界主"] || DATA.MOB_NONE;

// ---------- 秘境 / 灵地 ----------
(() => {
  for (const [C, key] of [[CFG.mijing, "mijing"], [CFG.lingdi, "lingdi"]]) {
    if (!C || !C.list) continue;
    C.list.forEach((d, i) => {
      const g = DATA.mobPick(CFG.mobs[key], d.name, i) || {};
      Object.assign(d, DATA.mobGroup(g));
      d.realm = (g["普通"] || [0])[0];
    });
  }
})();

// ---------- 试炼塔守关者（v221，config/mobs.js 的 tower）：按「第几层 ÷ 总层数」算境界、宗门功法学习比例、功法层、阶段倍率 ----------
//   逢 10 层 × BOSS（v222）；2 星及以上 = 上一星塔顶（不含 BOSS 倍）的全部属性 + 本星塔多出来的境界 / 肉身属性 + 本星宗门功法，本星部分 × 阶段倍率
DATA._tower = {};
DATA.towerPart = (star, floor, max) => {   // 返回 { own: 本星这一层的属性（已 × 倍率）, base: 上一星塔顶, realm, lay, pct, gf, mul }
  const T = CFG.mobs.tower || {}, RN = T.REALMS || 2, LN = RN * DATA.LAYERS, f = Math.max(1, Math.min(max, floor)), p = f / max;
  const step = (n) => Math.max(1, Math.min(n, Math.ceil(p * n - 1e-9)));
  const r0 = (CFG.sect.REQ_REALM || [])[star - 1] !== undefined ? CFG.sect.REQ_REALM[star - 1] : (star - 1) * RN;
  const j = step(LN), realm = Math.min(DATA.realms.length - 1, r0 + Math.floor((j - 1) / DATA.LAYERS)), lay = (j - 1) % DATA.LAYERS + 1;
  const gf = step(T.GF_MAX || 5), SN = T.STAGES || 50, sg = step(SN);
  const pct = T.PCT_START !== undefined ? T.PCT_START + (sg - 1) * (T.PCT_ADD || 0) : step(T.PCT_MAX || 50);   // v225 学习比例：第 1 段 PCT_START %，每段 + PCT_ADD %
  const mul = ((T.MUL === undefined ? 100 : T.MUL) + (sg - 1) * (T.MUL_ADD || 0)) / 100;   // v222 第 1 段 MUL %，每段 + MUL_ADD %
  const Lof = (r, l) => r * DATA.LAYERS + l;
  const cur = DATA.refStats(realm, lay, 0, star, 1), bd = DATA.mobBody(Lof(realm, lay));
  let pre = null, pbd = null, base = null;
  if (star > 1) {   // 上一星塔顶
    const pm = DATA.towerMax(star - 1), pp = DATA.towerPart(star - 1, pm, pm);
    pre = DATA.refStats(pp.realm, pp.lay, 0, star - 1, 1); pbd = DATA.mobBody(Lof(pp.realm, pp.lay)); base = pp.total;
  }
  const add = {}; for (const k of DATA.MOB_KEYS) add[k] = 0;
  for (const sc of DATA.sects || []) { if (sc.star !== star) continue;   // 只算本星的宗门功法，全部功法 × 学习比例（平均）
    for (const t of DATA.gfTypesOf(sc.src)) { const v = DATA.mobGfVal(DATA.gongfaId(sc.id, t.id), gf);
      if (add[t.stat] !== undefined) add[t.stat] += v[0] * pct / 100; if (t.stat2 && add[t.stat2] !== undefined) add[t.stat2] += v[1] * pct / 100; } }
  const own = {}, total = {};
  for (const k of DATA.MOB_KEYS) {
    own[k] = (cur[k] - (pre ? pre[k] : 0) + bd[k] - (pbd ? pbd[k] : 0) + add[k]) * mul;
    total[k] = (base ? base[k] : 0) + own[k];
  }
  total.manaBr = cur.manaBr;   // 修为突破法力（耗法力用，按当前境界，不叠加）
  return { own, base, total, realm, lay, pct, gf, mul, L: Lof(realm, lay) - 1 };
};
DATA.towerStage = (star, floor, max) => {
  const key = star + ":" + floor + ":" + max;
  if (!DATA._tower[key]) {
    const T = CFG.mobs.tower || {}, P = DATA.towerPart(star, floor, max), crit = T.CRIT !== undefined ? T.CRIT : DATA.mobCrit("考官");
    const B = T.BOSS || [0, 1], boss = B[0] > 0 && floor % B[0] === 0 ? B[1] : 1, o = Object.assign({}, P.total);   // v222 逢 10 层 × BOSS
    for (const k of DATA.MOB_KEYS) o[k] *= boss;
    DATA._tower[key] = Object.assign(o, { crit, L: P.L, realm: P.realm, layer: P.lay, pct: P.pct, gf: P.gf, mul: P.mul, boss });
  }
  return DATA._tower[key];
};

// ---------- 宗门考官：star 星级（1~10），i 职务序号（1 = 内门弟子 …… 6 = 宗主） ----------
DATA.mobExam = (star, i) => { const g = DATA.mobPick(CFG.mobs.sect, star + "星", star - 1) || {}; return DATA.mobPick(g, DATA.ranks[i] && DATA.ranks[i].name, i - 1); };
