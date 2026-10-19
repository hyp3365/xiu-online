/* =====================================================================
 * ★ 数值设置 · 秘境 ★（代码：modules/world.js 的 mjXxx；怪物属性、进入境界在 config/mobs.js 的 mijing）
 * 发现：在凡界第 find.map 张地图走完一次历练 / 探索，按 find.chance% 判定，一次最多发现一处
 *   地图序号：0 青云山林 1 黑风谷 2 万妖岭 3 幽冥沼泽 4 落星海 5 地火熔窟 6 埋骨战场 7 断魂谷 8 雷泽荒原
 * 一次 TIME 步：普通怪 MONSTERS + 精英 ELITES + 灵药 HERB + 矿脉 ORE（个数可写数字或 [最少, 最多]），其余空步，最后 BOSS 步是首领
 * 灵石：config/drops.js 的 RUN_STONE.mijing（按列表顺序）
 * 药材矿石：总数见 config/drops.js 的 dropTotal.mijing，从第 drops 张凡界地图的药材 / 矿石表等概率抽（不含 fixed）
 * extra 额外掉落：按事件分（monster / elite / boss / herbEvent / oreEvent），每条 { item, chance 几率%, n [最少, 最多] } 单独判定
 *   item：火髓、空间晶核、养神露；"耀石" / "灵晶" = 随机属性，或 "火耀石" 这样指定；也可写药材 / 矿石名或 content/items.js 的物品
 * 元婴期秘境另必掉养神露（config/sect.js 的 chuqiao.LU_DROP）
 * ===================================================================== */
window.CFG = window.CFG || {};

CFG.mijing = {
  DAILY: 1,          // 每处每天能进几次（历练、探索合计）
  TIME: 100,         // 一次走多少步
  MONSTERS: 12,      // 普通怪个数
  ELITES: 5,         // 精英怪个数
  BOSS: 1,           // 首领个数（放在最后）
  HERB: [5, 10],     // 灵药次数 [最少, 最多]
  ORE: [5, 10],      // 矿脉次数 [最少, 最多]

  // 秘境专用材料：name 名字  sell 出售价（灵石）  desc 说明  names 各属性名字（顺序固定，对应图标序号）
  items: {
    kj:   { name: "空间晶核", sell: 20, desc: "炼制空间石的专用材料。" },
    // 耀石：金 木 水 火 土 雷，装备 / 戒指用任意一种，法宝要同属性（用量见 config/forge.js）
    ys:   { name: "耀石", names: ["金耀石", "木耀石", "水耀石", "火耀石", "土耀石", "雷耀石"], sell: 20,
            desc: "装备、戒指、法宝炼制和强化的专用矿石。装备、戒指可用任意一种，法宝要用同属性的。" },
    // 灵晶：金 木 水 火 土，炼制、强化灵珠（config/array.js 的 lingzhu）
    lj:   { name: "灵晶", names: ["金灵晶", "木灵晶", "水灵晶", "火灵晶", "土灵晶"], sell: 20, desc: "炼制、强化灵珠的材料，凡界秘境首领掉落。" },
    lu:   { name: "养神露", sell: 20, desc: "炼制养神丹的材料，元婴期秘境、万妖岭首领掉落。" },
    wdg:  { name: "悟道果", sell: 10, desc: "在「洞府 → 悟道室」悟道时消耗。四界功德司用功德购买。" },
    yd:   { name: "养神丹", sell: 50, desc: "在「修炼 → 神识」养神，提升神识强度（每天可元婴出窍的次数）。2 星宗门炼丹房学丹方炼制。" },
  },

  // 秘境列表：顺序 = 存档序号，不要调换或插入；进入境界依次为练气、筑基……大乘（见 config/mobs.js）
  list: [
    { name: "灵泉洞天", find: { map: 0, chance: 5 }, drops: 0,
      bossName: "灵泉守护·碧水灵蛟", monsters: ["灵泉水妖", "碧鳞鱼精", "水灵", "青藤妖"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [1, 3] }, { item: "空间晶核", chance: 50, n: [1, 1] }, { item: "耀石", chance: 50, n: [1, 1] }, { item: "灵晶", chance: 100, n: [1, 2] }],
      } },
    { name: "古修洞府", find: { map: 1, chance: 5 }, drops: 1,
      bossName: "古修残魂", monsters: ["守府傀儡", "古修残影", "石甲卫", "噬灵鼠"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [1, 3] }, { item: "空间晶核", chance: 50, n: [1, 1] }, { item: "耀石", chance: 50, n: [1, 1] }, { item: "灵晶", chance: 100, n: [1, 2] }],
      } },
    { name: "赤炎火窟", find: { map: 2, chance: 5 }, drops: 2,
      bossName: "火窟之主·赤炎魔君", monsters: ["火灵", "炎魔", "赤炎蜥", "熔岩巨人"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [2, 6] }, { item: "空间晶核", chance: 50, n: [1, 2] }, { item: "耀石", chance: 50, n: [1, 2] }, { item: "灵晶", chance: 100, n: [1, 2] }],
      } },
    { name: "寒渊冰宫", find: { map: 3, chance: 5 }, drops: 3,
      bossName: "冰宫女帝·玄冰凤", monsters: ["冰魄妖", "寒霜狼", "冰傀儡", "雪妖"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [2, 6] }, { item: "空间晶核", chance: 50, n: [1, 2] }, { item: "耀石", chance: 50, n: [1, 2] }, { item: "灵晶", chance: 100, n: [1, 2] }],
      } },
    { name: "万剑冢", find: { map: 3, chance: 5 }, drops: 3,
      bossName: "剑冢剑灵", monsters: ["剑灵", "剑魂", "残剑傀儡", "剑奴"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [3, 9] }, { item: "空间晶核", chance: 50, n: [1, 3] }, { item: "耀石", chance: 50, n: [1, 3] }, { item: "灵晶", chance: 100, n: [1, 2] }],
      } },
    { name: "上古战场", find: { map: 4, chance: 5 }, drops: 4,
      bossName: "上古战魂·不灭战神", monsters: ["上古战魂", "骷髅战将", "战场怨灵", "血煞魔兵"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [3, 9] }, { item: "空间晶核", chance: 50, n: [1, 3] }, { item: "耀石", chance: 50, n: [1, 3] }, { item: "灵晶", chance: 100, n: [1, 2] }],
      } },
    { name: "星陨秘境", find: { map: 5, chance: 5 }, drops: 5,
      bossName: "星陨之主·噬星兽", monsters: ["星兽", "陨星傀儡", "星芒灵", "噬星虫"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [4, 12] }, { item: "空间晶核", chance: 50, n: [1, 4] }, { item: "耀石", chance: 50, n: [1, 4] }, { item: "灵晶", chance: 100, n: [1, 2] }],
      } },
    { name: "幽冥鬼域", find: { map: 6, chance: 5 }, drops: 6,
      bossName: "鬼域之王·幽冥鬼帝", monsters: ["鬼将", "幽魂", "冥鬼", "骨魔"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [4, 12] }, { item: "空间晶核", chance: 50, n: [1, 4] }, { item: "耀石", chance: 50, n: [1, 4] }, { item: "灵晶", chance: 100, n: [1, 2] }],
      } },
    { name: "太虚幻境", find: { map: 6, chance: 5 }, drops: 6,
      bossName: "太虚幻主", monsters: ["幻影修士", "心魔幻象", "虚空灵", "幻兽"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }, { item: "灵晶", chance: 100, n: [1, 2] }],
      } },
    { name: "混沌古界", find: { map: 7, chance: 5 }, drops: 7,
      bossName: "混沌古兽", monsters: ["混沌兽", "太古魔灵", "混沌之灵", "古界巨人"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }, { item: "灵晶", chance: 100, n: [1, 2] }],
      } },
  ],
};
