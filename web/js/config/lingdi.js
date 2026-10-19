/* =====================================================================
 * ★ 数值设置 · 灵地 ★（代码：modules/world.js，和秘境共用 mjXxx 函数，k = "ld"；怪物属性、境界要求在 config/mobs.js 的 lingdi）
 * 发现：在 w 那一界第 find.map 张地图（0 起）走完一次历练 / 探索，按 find.chance% 判定，一次最多发现一处
 * 一次 TIME 步：普通怪 MONSTERS + 精英 ELITES + 灵药 HERB_MIN~MAX + 矿脉 ORE_MIN~MAX，其余空步，最后 BOSS 步是首领
 * 灵石 = 每只普通怪基数（所在界 RUN_STONE 按 L 插值）× 随机(1~2.5) × STONE_RATE × 种类倍率 × stone × MAP_STONE（config/drops.js）
 * 药材矿石：总数见 config/drops.js 的 dropTotal.lingdi，从发现它的四界地图药材 / 矿石表（含特产）等概率抽
 * 字段：w 界（xian 仙 / ming 冥 / mo 魔 / shen 神）  L 层序（只算灵石，取发现地图北域的层序）  bossName 首领  monsters 普通怪（精英 = "精英·"+名）
 *       extra 额外掉落，按事件分（monster / elite / boss / herbEvent / oreEvent），每条 { item 物品名, chance 几率%, n [最少, 最多] }，物品名写法见 config/mijing.js
 * ===================================================================== */
window.CFG = window.CFG || {};

CFG.lingdi = {
  DAILY: 1,          // 每处每天能进几次（历练、探索合计）
  TIME: 100,         // 一次走多少步
  MONSTERS: 12,      // 普通怪个数
  ELITES: 5,         // 精英怪个数
  BOSS: 1,           // 首领个数（放在最后）
  HERB_MIN: 5,       // 灵药次数下限
  HERB_MAX: 10,      // 灵药次数上限
  ORE_MIN: 5,        // 矿脉次数下限
  ORE_MAX: 10,       // 矿脉次数上限

  // 灵地列表：顺序 = 存档序号，不要调换或插入
  list: [
    { name: "瑶池仙境", w: "xian", find: { map: 2, chance: 5 }, stone: 2, L: 119,   // 仙界第 3 张图（大焚天）
      bossName: "瑶池圣母·青鸾仙后", monsters: ["瑶池仙鹤", "碧波仙鲤", "守池仙娥", "琼花灵"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "蟠桃灵园", w: "xian", find: { map: 5, chance: 5 }, stone: 2, L: 149,   // 仙界第 6 张图（始皇天）
      bossName: "蟠桃园主·千年桃仙", monsters: ["桃林仙猿", "护园力士", "蟠桃花妖", "仙果灵童"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "九天云阙", w: "xian", find: { map: 8, chance: 5 }, stone: 2, L: 179,   // 仙界第 9 张图（太皇天）
      bossName: "云阙天尊·九天玄鹤", monsters: ["云阙天兵", "九天雷鹏", "云中仙将", "飞霞剑灵"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "黄泉幽谷", w: "ming", find: { map: 2, chance: 5 }, stone: 2, L: 119,   // 冥界第 3 张图（乱魂地狱）
      bossName: "幽谷之主·黄泉鬼母", monsters: ["黄泉游魂", "幽谷鬼蝠", "引路阴差", "枯骨妖藤"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "忘川冥渊", w: "ming", find: { map: 5, chance: 5 }, stone: 2, L: 149,   // 冥界第 6 张图（血莲地狱）
      bossName: "冥渊之主·忘川冥龙", monsters: ["忘川水鬼", "冥渊骨鱼", "渡魂舟灵", "彼岸花妖"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "轮回古殿", w: "ming", find: { map: 8, chance: 5 }, stone: 2, L: 179,   // 冥界第 9 张图（青莲地狱）
      bossName: "古殿殿主·六道轮回使", monsters: ["轮回鬼卒", "古殿判官", "六道残魂", "业火鬼将"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "血煞魔渊", w: "mo", find: { map: 2, chance: 5 }, stone: 2, L: 149,   // 魔界第 3 张图（噬魂魔渊）
      bossName: "魔渊之主·血煞魔尊", monsters: ["血煞魔兵", "血河魔蛟", "煞气魔灵", "嗜血魔蝠"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "噬魂魔窟", w: "mo", find: { map: 5, chance: 5 }, stone: 2, L: 179,   // 魔界第 6 张图（天魔宫）
      bossName: "魔窟之主·噬魂魔君", monsters: ["噬魂魔蛛", "窟中魔影", "摄魂魔女", "魂火魔灵"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "万魔古坛", w: "mo", find: { map: 8, chance: 5 }, stone: 2, L: 209,   // 魔界第 9 张图（魔神殿）
      bossName: "古坛祭主·万魔天尊", monsters: ["古坛魔祭", "万魔傀儡", "魔纹石像", "祭坛魔将"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "太初神域", w: "shen", find: { map: 2, chance: 5 }, stone: 2, L: 159,   // 神界第 3 张图（变天）
      bossName: "太初神主·先天神祇", monsters: ["太初神兵", "先天灵兽", "神域守卫", "初光之灵"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "鸿蒙神墟", w: "shen", find: { map: 5, chance: 5 }, stone: 2, L: 189,   // 神界第 6 张图（颢天）
      bossName: "神墟之主·鸿蒙古神", monsters: ["鸿蒙古兽", "神墟残灵", "紫气神将", "墟中石神"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "混元神殿", w: "shen", find: { map: 8, chance: 5 }, stone: 2, L: 219,   // 神界第 9 张图（阳天）
      bossName: "神殿之主·混元神帝", monsters: ["混元神卫", "神殿金甲", "混元灵龙", "殿前神将"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
  ],
};
