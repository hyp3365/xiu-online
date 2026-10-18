/* =====================================================================
 * 数据：境界 & 人物成长
 * ---------------------------------------------------------------------
 * 改境界名字、层数、修为需求、每层属性成长，都在这个文件里。
 * 总层序 L：境界序号 × 10 + 层(0~9)。例如 筑基期三层 = 1*10 + 2 = 12
 * ===================================================================== */
window.DATA = window.DATA || {};

// 24 个大境界（顺序即进阶顺序；v21 改）
// 名字在 config/names.js 的 realm（这里是原名）
DATA.NM_DEF.realm = [
  "练气", "筑基", "金丹", "元婴", "出窍", "化神", "练虚", "合体", "洞真", "大乘", "渡劫",
  "散仙", "游仙", "地仙", "天仙", "金仙", "太乙金仙", "大罗金仙", "玄仙", "仙君", "帝仙", "准圣", "天道圣人", "大道圣人",
];
DATA.realms = DATA.nmArr(CFG.names.realm, DATA.NM_DEF.realm);
// 显示：序号 → "练气期" / "散仙"（仙人以上不加「期」）；-1 = 凡人
DATA.REALM_TEXT = { mortal: DATA.nmPick(CFG.names.realmText, "mortal", "凡人"), suffix: DATA.nmPick(CFG.names.realmText, "suffix", "期") };
DATA.realmLabel = i => i < 0 ? DATA.REALM_TEXT.mortal : DATA.realms[i] + (i <= 10 ? DATA.REALM_TEXT.suffix : "");

// 每个大境界的层数
DATA.LAYERS = 10;
DATA.layerNames = DATA.nmArr(CFG.names.layer, ["一层", "二层", "三层", "四层", "五层", "六层", "七层", "八层", "九层", "十层"]);
// 法宝的境界倍率（config/forge.js 的 DMG_REALM）按境界名写：境界改名后把键换成新名
for (const k of ["DMG_REALM"]) {
  const o = ((CFG.forge || {}).fabao || {})[k];
  if (!o || Array.isArray(o)) continue;
  const ent = Object.keys(o).map(n => { const i = DATA.NM_DEF.realm.indexOf(n); return [i >= 0 ? DATA.realms[i] : n, o[n]]; });
  Object.keys(o).forEach(n => delete o[n]); ent.forEach(([n, v]) => { o[n] = v; });
}

/* 以下数值都来自 js/config/ 下的数值文件（数值设置文件），这里只做计算 */
const _R = CFG.realm, _P = CFG.player;
// 境界突破表（config/realm.js）：一行一个境界，没写的境界沿用上面最近一行；T = 要突破到的总层序（0 = 第一境界一层）
DATA.brRow = (rows, r) => { let o = null; for (const x of rows || []) if (x[0] <= r && (!o || x[0] >= o[0])) o = x; return o; };
// 突破到第 T 层需要的修为 / 气血：行 = [境界, 一层需要, 十层需要]，中间每层平均加，最后 × 总倍率 rate
DATA.brNeed = (rows, T, rate) => { T = Math.max(0, T); const x = DATA.brRow(rows, Math.floor(T / DATA.LAYERS)); return x ? Math.round((x[1] + ((x[2] || x[1]) - x[1]) / (DATA.LAYERS - 1) * (T % DATA.LAYERS)) * (rate || 1)) : 0; };
DATA.needExp = L => DATA.brNeed(_R.EXP, L + 1, _R.EXP_RATE);   // 第 L 层 → 第 L+1 层
DATA.MORTAL_EXP = DATA.brNeed(_R.EXP, 0, _R.EXP_RATE);          // 凡人 → 练气一层
// 突破 n 层（第 0 ~ n-1 层）增加的属性合计（缓存）
DATA._brSum = {};
DATA.brSum = (rows, n, tag) => {
  const c = DATA._brSum[tag] || (DATA._brSum[tag] = [{}]);
  for (let T = c.length - 1; T < n; T++) {
    const o = Object.assign({}, c[T]), g = (DATA.brRow(rows, Math.floor(T / DATA.LAYERS)) || [0, {}])[1] || {};
    for (const k in g) o[k] = (o[k] || 0) + (+g[k] || 0);
    c[T + 1] = o;
  }
  return c[Math.max(0, n)] || {};
};
// 修为突破属性：凡人基础（player.base / RES_BASE）+ 突破到第 L 层的合计；L < 0 = 凡人
DATA.realmStat = (L, k) => (k === "res" ? _P.RES_BASE || 0 : _P.base[k] || 0) + (DATA.brSum(_R.GAIN, L < 0 ? 0 : L + 1, "xw")[k] || 0);
// 肉身突破属性：突破 n 层的合计
DATA.bodyStat = (n, k) => DATA.brSum(_R.BODY_GAIN, n, "rs")[k] || 0;

// 人物属性：base = 凡人基础（再加修为突破合计，见 DATA.realmStat）；fixed 不随境界
DATA.playerFixed = _P.fixed;
// 命中率：见 config/battle.js 的 HIT_*（v183 按整档加减）
DATA.hitChance = (hit, dodge, k) => { const B = CFG.battle, d = Math.max(0, dodge || 0), diff = ((hit || 0) - d) / Math.max(1, d + (B.HIT_PAD || 0)) * 100;   // 相对差 = (命中 − 闪避) ÷ (闪避 + HIT_PAD)
  // v183 按整档算：高 每满 HIT_UP_STEP % +HIT_UP_ADD %；低 每满 HIT_DN_STEP % −HIT_DN_ADD %（不满一档不变）
  const add = diff >= 0 ? Math.floor(diff / B.HIT_UP_STEP + 1e-9) * B.HIT_UP_ADD : -Math.floor(-diff / B.HIT_DN_STEP + 1e-9) * B.HIT_DN_ADD;
  // v220 k：0 普通攻击 / 1 法术（+ SPELL_HIT_ADD）/ 2 法宝（+ FABAO_HIT_ADD），加完仍不超过 HIT_MAX
  const bonus = k === 1 ? (B.SPELL_HIT_ADD || 0) : k === 2 ? (B.FABAO_HIT_ADD || 0) : 0;
  return Math.min(B.HIT_MAX, Math.max(B.HIT_MIN, B.HIT_BASE + add) + bonus); };
DATA.dodgeChance = (hit, dodge, k) => 100 - DATA.hitChance(hit, dodge, k);   // 闪避几率 = 100 − 命中率
DATA.CRIT_CAP = _P.CRIT_CAP;



// 修炼节奏：每 10 秒结算一次
DATA.TICK = 10;

// v171 保底伤害：练气一层 MIN_BASE，每层 + MIN_STEP（L = 总层序，0 = 练气一层）
DATA.minDmg = L => (CFG.battle.MIN_BASE === undefined ? 1 : CFG.battle.MIN_BASE) + (CFG.battle.MIN_STEP === undefined ? 3 : CFG.battle.MIN_STEP) * Math.max(0, L || 0);
