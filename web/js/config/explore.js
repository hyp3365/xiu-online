/* ★ 历练 / 自动探索（代码：modules/world.js makePlan / exploreStep / exploreMs）★
 * 一次走 TIME 步：普通怪 MONSTERS + 精英 ELITES + 灵药 随机(HERB_MIN~HERB_MAX) + 矿脉 随机(ORE_MIN~ORE_MAX)，
 *   其余补「无事发生」，打乱顺序；最后 BOSS 步固定是首领。药材矿石总数按 config/drops.js 的 dropTotal，落在灵药 / 矿脉 / 怪物步。
 * 每步秒数 = max(STEP_MIN, STEP_SEC − 宗门秘法「神行」)；每步恢复 = 上限 × HEAL_STEP（另加宗门秘法「斗血 / 斗灵」）
 * 战败只丢本次收获。秘境步数、怪物数见 config/mijing.js，但每步秒数、恢复、STOP 用这里的。
 * ===================================================================== */
window.CFG = window.CFG || {};

CFG.explore = {
  TIME: 100,         // 每次走多少步
  END_WAIT: 3,       // 走完后再等几秒才结算（秒，「神行」不影响）
  STEP_SEC: 3,       // 每步秒数
  STEP_MIN: 0.1,     // 每步最少秒数
  STOP: 0.3,         // 生命低于上限此比例：不能开始历练 / 秘境 / 灵地（一键探索中途也会停）；自动探索 / 出窍的休养看战斗设置的「继续探索」
  HEAL_STEP: 0,      // 每步恢复生命、法力上限的比例（0.02 = 2%）
  MONSTERS: 10,      // 普通怪个数
  ELITES: 3,         // 精英怪个数
  BOSS: 1,           // 首领个数（放在最后）
  HERB_MIN: 5,       // 发现灵药次数（下限）
  HERB_MAX: 10,      // 发现灵药次数（上限）
  ORE_MIN: 5,        // 发现矿脉次数（下限）
  ORE_MAX: 10,       // 发现矿脉次数（上限）
  // 凡界灵矿：不用历练，不遇怪，每步灵石 = 本图北域一次探索平均灵石 ÷ TIME × 随机(0.5~1.5)
  KUANG: {
    NAME: "{map}灵矿",                    // {map} = 地图名
    DESC: "灵石矿，挖掘可以获得灵石",
    TIME: 100,                            // 每次走多少步
  },
};
