/* ★ 各地图掉落（代码：modules/world.js rollMonsterLoot / matPlan / stepMats、data/maps.js）★
 * 凡界地图怪物灵石 = 该图 stone 随机整数[最少, 最多] × STONE_RATE × 种类倍率(1 / ELITE_STONE / BOSS_STONE)
 * 四界地图 / 秘境 / 灵地怪物灵石 = 每只普通怪基数 × 随机(1~2.5) × STONE_RATE × 种类倍率 × 地图(秘境)stone × MAP_STONE
 *   每只普通怪基数 = RUN_STONE 按区域层序插值 ÷ (1.75 × (普通数 + 精英数×ELITE_STONE + 首领数×BOSS_STONE))
 * 药材矿石：每次走完总数（凡界按该图 herb / ore，其余按 dropTotal），分散到灵药 / 矿脉 / 怪物步，每个从药材 / 矿石表等权重抽。
 * ===================================================================== */
window.CFG = window.CFG || {};

// 区域层序 L：凡界 = 地图序号(0起)×10 + config/mobs.js FAN_L；秘境 / 灵地用自己的 L；四界见 config/worldmaps.js
CFG.drop = {
  STONE_RATE: 1,     // 灵石总倍率
  MAP_STONE: 1.2,    // 四界地图 / 秘境 / 灵地怪物灵石再乘（凡界地图、灵矿不乘）
  ELITE_STONE: 2,    // 精英怪灵石倍率
  BOSS_STONE: 3,     // 首领灵石倍率
  // 一次探索（全胜）平均灵石 [本界第一张图东域, 最后一张图北域]，中间按 L 线性递增（凡界地图不用，见 mapDrops 的 stone）
  //   秘境 / 灵地按自己的 L 套所在界，再 × 自己的 stone（config/mijing.js、lingdi.js）；fan 只给秘境用
  RUN_STONE: { fan: [80, 180], xian: [350, 1000], ming: [350, 1000], mo: [350, 1000], shen: [450, 1200] },
};

// 每次走完的药材 / 矿石总数 = 随机整数[最少, 最多]（药材、矿石分开算）；秘境 / 灵地的 extra 和 mapDrops 的 fixed 另外掉
//   凡界地图的总数在下面 mapDrops 每张图单独写
CFG.dropTotal = {
  explore: { herb: [5, 15],   ore: [5, 15] },    // 四界地图探索 / 历练 / 出窍
  mijing:  { herb: [30, 60],  ore: [30, 60] },   // 秘境（表借用 mijing.js drops 指定的地图）
  lingdi:  { herb: [60, 100], ore: [60, 100] },  // 灵地（表借用发现它的四界地图）
};

// 凡界 9 张地图（四域共用）
//   herb / ore（外层）：9 张图共用的药材 / 矿石名（等概率抽）；名字须在 config/items.js 的 mats；坊市只卖这些
//   maps 每张图一行（顺序 = 地图序号 0 青云山林 … 8 雷泽荒原）：
//     stone 每只普通怪灵石随机[最少, 最多]（精英 / 首领再乘 ELITE_STONE / BOSS_STONE）
//     herb / ore 每次走完药材 / 矿石总数随机[最少, 最多]
//     fixed（可选）必掉 { 事件: { 名字: [最少, 最多] } }，事件 monster / elite / boss / herbEvent / oreEvent；
//       可写药材矿石、专用材料或 content/items.js 自定义物品；秘境借用时不带 fixed
CFG.mapDrops = {
  herb: ["青灵草", "凝露花", "赤血参", "紫灵芝", "幽冥花", "星辰草"],
  ore:  ["铁精", "寒铁", "赤铜精", "玄冥铁", "星辰砂", "虚空石"],
  maps: [
    { stone: [3, 8], herb: [5, 15], ore: [5, 15] },   // 第 1 张 青云山林
    { stone: [3, 9], herb: [5, 15], ore: [5, 15] },   // 第 2 张 黑风谷
    { stone: [4, 10], herb: [5, 15], ore: [5, 15],   // 第 3 张 万妖岭
      fixed: { boss: { 养神露: [10, 10] } } },   // 首领必掉养神露 10 个（炼养神丹用）
    { stone: [4, 11], herb: [5, 15], ore: [5, 15] },   // 第 4 张 幽冥沼泽
    { stone: [5, 12], herb: [5, 15], ore: [5, 15] },   // 第 5 张 落星海
    { stone: [5, 13], herb: [5, 15], ore: [5, 15] },   // 第 6 张 地火熔窟
    { stone: [5, 14], herb: [5, 15], ore: [5, 15] },   // 第 7 张 埋骨战场
    { stone: [6, 15], herb: [5, 15], ore: [5, 15] },   // 第 8 张 断魂谷
    { stone: [6, 16], herb: [5, 15], ore: [5, 15] },   // 第 9 张 雷泽荒原
  ],
};

// 四界地图的药材 / 矿石名（等概率抽）；stone 在 config/worldmaps.js
//   special 本界特产：并入本界各图药材 / 矿石抽取池；名字、价格在 config/items.js 的 matsOther
CFG.worldDrops = {
  xian: { herb: ["天元草", "玄霜花", "紫府灵根", "万年雪莲", "星河藤"],   // 仙界
          ore:  ["天外陨铁", "玄晶石", "星辰金", "混沌铜", "太虚玉"],
          special: ["琼华仙草", "仙霞玉髓"] },
  ming: { herb: ["天元草", "玄霜花", "紫府灵根", "万年雪莲", "星河藤"],   // 冥界
          ore:  ["天外陨铁", "玄晶石", "星辰金", "混沌铜", "太虚玉"],
          special: ["冥魂花", "冥河寒晶"] },
  mo:   { herb: ["天元草", "玄霜花", "紫府灵根", "万年雪莲", "星河藤"],   // 魔界
          ore:  ["天外陨铁", "玄晶石", "星辰金", "混沌铜", "太虚玉"],
          special: ["噬血魔莲", "魔焰晶"] },
  shen: { herb: ["天元草", "玄霜花", "紫府灵根", "万年雪莲", "星河藤"],   // 神界
          ore:  ["天外陨铁", "玄晶石", "星辰金", "混沌铜", "太虚玉"],
          special: ["神曦花", "神辉金"] },
};
