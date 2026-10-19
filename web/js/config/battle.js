/* =====================================================================
 * ★ 数值设置 · 战斗 ★（代码：modules/world.js 的 battle；雷劫 modules/trib.js；命中 data/realms.js）
 * 保底伤害 = MIN_BASE + 出手方层序 × MIN_STEP（凡人按练气一层）
 * 普攻 = max(保底, 攻击 − 对方防御 × DEF_RATE)
 * 法术 / 法宝 = max(保底, 威力 − 对方防御 × RES_RATE − 对方该系抗性 × RES_EL_RATE)（威力含法术% / 法宝% / 灵根）
 * 命中后：伤害 × 随机(RAND_MIN~RAND_MAX)，暴击（几率上限见 config/player.js 的 CRIT_CAP）× CRIT_MULT
 * 雷劫只用普攻公式，不能闪避
 * ===================================================================== */
window.CFG = window.CFG || {};

CFG.battle = {
  MIN_BASE: 1,       // 保底伤害：练气一层的值
  MIN_STEP: 3,       // 保底伤害：每多一层 +
  DEF_RATE: 0.9,     // 普攻：对方防御抵消比例
  RAND_MIN: 0.9,     // 伤害随机下限（倍）
  RAND_MAX: 1.1,     // 伤害随机上限（倍）
  CRIT_MULT: 2,      // 暴击伤害倍率
  MAX_ROUNDS: 100,   // 一场最多回合，打满未击败对方算失败（雷劫不受限）
  TEST_ROUNDS: 200,  // 宗门「实力测试」最多回合
  // 命中率% = HIT_BASE ± 档数：相对差 = (命中 − 对方闪避) ÷ (对方闪避 + HIT_PAD) × 100
  //   高于对方每满 HIT_UP_STEP% 加 HIT_UP_ADD%；低于对方每满 HIT_DN_STEP% 减 HIT_DN_ADD%；结果限制在 HIT_MIN ~ HIT_MAX
  HIT_BASE: 80, HIT_UP_STEP: 6, HIT_UP_ADD: 1, HIT_DN_STEP: 5, HIT_DN_ADD: 2.5, HIT_MAX: 96, HIT_MIN: 30, HIT_PAD: 0,
  SPELL_HIT_ADD: 25,   // 法术命中率额外 +%（加完仍不超过 HIT_MAX）
  FABAO_HIT_ADD: 15,   // 法宝命中率额外 +%（同上）
  SPEED_RAND: [95, 105],   // 每场人物速度 × 随机[最小, 最大]%，速度高者先手（怪物不随机）
  TOWER_HP_MIN: 0.3, // 生命低于上限此比例不能挑战试炼塔、晋升考验
};

// 属性抗性（法术 / 法宝减免，双方相同）
CFG.battle.RES_RATE = 0.601;      // 对方防御 × 此值
CFG.battle.RES_EL_RATE = 0.462;   // 对方该系抗性 × 此值

// 战斗画面播放（结果已算好，只是播放）
CFG.battle.ACT_SEC = 1.5;   // 每次出手播放间隔（秒）
CFG.battle.ANIM_SLOW = 1.4; // 动作动画放慢倍数（1 = 原速）
CFG.battle.SKIP_SEC = 3;    // 现场战斗几秒后可跳过（秒）
