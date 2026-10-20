/* =====================================================================
 * ★ 数值设置 · 灵地 ★（代码：modules/world.js，和秘境共用 mjXxx 函数，k = "ld"；怪物属性、境界要求在 config/mobs.js 的 lingdi）
 * 发现：在 w 那一界第 find.map 张地图（0 起）走完一次历练 / 探索，按 find.chance% 判定，一次最多发现一处
 * 一次 TIME 步：普通怪 MONSTERS + 精英 ELITES + 灵药 HERB + 矿脉 ORE（个数可写数字或 [最少, 最多]），其余空步，最后 BOSS 步是首领
 * 灵石：config/drops.js 的 RUN_STONE.lingdi（按本界列表顺序）
 * 药材矿石：总数见 config/drops.js 的 dropTotal.lingdi，从发现它的四界地图药材 / 矿石表（含特产）等概率抽
 * 字段：w 界（xian 仙 / ming 冥 / mo 魔 / shen 神）  bossName 首领  monsters 普通怪（精英 = "精英·"+名）
 *       extra 额外掉落，按事件分（monster / elite / boss / herbEvent / oreEvent），每条 { item 物品名, chance 几率%, n [最少, 最多] }，物品名写法见 config/mijing.js
 * ===================================================================== */
window.CFG = window.CFG || {};

CFG.lingdi = {
  DAILY: 1,          // 每处每天能进几次（历练、探索合计）
  TIME: 100,         // 一次走多少步
  MONSTERS: 12,      // 普通怪个数
  ELITES: 5,         // 精英怪个数
  BOSS: 1,           // 首领个数（放在最后）
  HERB: [5, 10],     // 灵药次数 [最少, 最多]
  ORE: [5, 10],      // 矿脉次数 [最少, 最多]

  // 灵地列表：顺序 = 存档序号，不要调换或插入（每界 12 处：第 1~9 张图各发现一处，第 10 张图发现 10~12；界面按发现地图排序）
  list: [
    { name: "瑶池仙境", w: "xian", find: { map: 2, chance: 5 },   // 仙界第 3 张图（大焚天）
      bossName: "瑶池圣母·青鸾仙后", monsters: ["瑶池仙鹤", "碧波仙鲤", "守池仙娥", "琼花灵"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "蟠桃灵园", w: "xian", find: { map: 5, chance: 5 },   // 仙界第 6 张图（始皇天）
      bossName: "蟠桃园主·千年桃仙", monsters: ["桃林仙猿", "护园力士", "蟠桃花妖", "仙果灵童"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "九天云阙", w: "xian", find: { map: 8, chance: 5 },   // 仙界第 9 张图（太皇天）
      bossName: "云阙天尊·九天玄鹤", monsters: ["云阙天兵", "九天雷鹏", "云中仙将", "飞霞剑灵"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "黄泉幽谷", w: "ming", find: { map: 2, chance: 5 },   // 冥界第 3 张图（乱魂地狱）
      bossName: "幽谷之主·黄泉鬼母", monsters: ["黄泉游魂", "幽谷鬼蝠", "引路阴差", "枯骨妖藤"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "忘川冥渊", w: "ming", find: { map: 5, chance: 5 },   // 冥界第 6 张图（血莲地狱）
      bossName: "冥渊之主·忘川冥龙", monsters: ["忘川水鬼", "冥渊骨鱼", "渡魂舟灵", "彼岸花妖"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "轮回古殿", w: "ming", find: { map: 8, chance: 5 },   // 冥界第 9 张图（青莲地狱）
      bossName: "古殿殿主·六道轮回使", monsters: ["轮回鬼卒", "古殿判官", "六道残魂", "业火鬼将"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "血煞魔渊", w: "mo", find: { map: 2, chance: 5 },   // 魔界第 3 张图（噬魂魔渊）
      bossName: "魔渊之主·血煞魔尊", monsters: ["血煞魔兵", "血河魔蛟", "煞气魔灵", "嗜血魔蝠"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "噬魂魔窟", w: "mo", find: { map: 5, chance: 5 },   // 魔界第 6 张图（天魔宫）
      bossName: "魔窟之主·噬魂魔君", monsters: ["噬魂魔蛛", "窟中魔影", "摄魂魔女", "魂火魔灵"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "万魔古坛", w: "mo", find: { map: 8, chance: 5 },   // 魔界第 9 张图（魔神殿）
      bossName: "古坛祭主·万魔天尊", monsters: ["古坛魔祭", "万魔傀儡", "魔纹石像", "祭坛魔将"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "太初神域", w: "shen", find: { map: 2, chance: 5 },   // 神界第 3 张图（变天）
      bossName: "太初神主·先天神祇", monsters: ["太初神兵", "先天灵兽", "神域守卫", "初光之灵"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "鸿蒙神墟", w: "shen", find: { map: 5, chance: 5 },   // 神界第 6 张图（颢天）
      bossName: "神墟之主·鸿蒙古神", monsters: ["鸿蒙古兽", "神墟残灵", "紫气神将", "墟中石神"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "混元神殿", w: "shen", find: { map: 8, chance: 5 },   // 神界第 9 张图（阳天）
      bossName: "神殿之主·混元神帝", monsters: ["混元神卫", "神殿金甲", "混元灵龙", "殿前神将"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "紫霞仙谷", w: "xian", find: { map: 0, chance: 5 },   // 仙界第 1 张图（梵度天）
      bossName: "紫霞谷主·流霞仙子", monsters: ["紫霞灵蝶", "霞光仙鹿", "采霞仙童", "流云剑灵"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "碧落灵台", w: "xian", find: { map: 1, chance: 5 },   // 仙界第 2 张图（西极天）
      bossName: "灵台守尊·碧落仙翁", monsters: ["碧落仙鹤", "灵台力士", "守台仙兵", "玉露花灵"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "广寒月宫", w: "xian", find: { map: 3, chance: 5 },   // 仙界第 4 张图（朱雀天）
      bossName: "月宫之主·广寒素娥", monsters: ["玉兔灵仙", "桂影仙灵", "月华仙娥", "寒宫冰魄"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "天河星渚", w: "xian", find: { map: 4, chance: 5 },   // 仙界第 5 张图（七曜天）
      bossName: "星渚之主·天河银龙", monsters: ["天河水兵", "银汉灵鲤", "星砂傀儡", "渡河仙将"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "琅嬛福地", w: "xian", find: { map: 6, chance: 5 },   // 仙界第 7 张图（荣华天）
      bossName: "福地主人·琅嬛书仙", monsters: ["守卷仙童", "墨灵书妖", "玉简灵", "藏经力士"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "昆仑玉墟", w: "xian", find: { map: 7, chance: 5 },   // 仙界第 8 张图（妙成天）
      bossName: "玉墟之主·昆仑开明兽", monsters: ["昆仑玉兽", "玉墟守卫", "雪顶仙鹤", "玉髓石灵"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "凌霄金阙", w: "xian", find: { map: 9, chance: 5 },   // 仙界第 10 张图（玉皇天）
      bossName: "金阙天君·凌霄金鹏", monsters: ["金阙天兵", "金翅仙鹏", "凌霄卫士", "金甲力士"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "太清仙境", w: "xian", find: { map: 9, chance: 5 },   // 仙界第 10 张图（玉皇天）
      bossName: "太清道尊·紫气老君", monsters: ["太清道童", "炼丹火灵", "青牛灵兽", "紫气仙将"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "无极天墟", w: "xian", find: { map: 9, chance: 5 },   // 仙界第 10 张图（玉皇天）
      bossName: "天墟之主·无极仙帝", monsters: ["无极仙卫", "天墟残灵", "星辰剑灵", "仙帝傀儡"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "鬼门关隘", w: "ming", find: { map: 0, chance: 5 },   // 冥界第 1 张图（枉死地狱）
      bossName: "关隘守将·鬼门阴帅", monsters: ["守关鬼卒", "勾魂使者", "阴风鬼影", "关前石兽"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "奈何桥畔", w: "ming", find: { map: 1, chance: 5 },   // 冥界第 2 张图（白骨地狱）
      bossName: "桥畔之主·孟婆幽灵", monsters: ["桥头冤魂", "奈何水鬼", "汤婆鬼仆", "引魂灯灵"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "酆都鬼城", w: "ming", find: { map: 3, chance: 5 },   // 冥界第 4 张图（黑绳地狱）
      bossName: "鬼城之主·酆都鬼王", monsters: ["鬼城阴兵", "夜叉鬼将", "城隍鬼吏", "无头鬼骑"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "阴山尸林", w: "ming", find: { map: 4, chance: 5 },   // 冥界第 5 张图（寂静地狱）
      bossName: "尸林之主·千年尸王", monsters: ["阴山僵尸", "尸林鬼鸦", "腐骨妖狼", "养尸鬼师"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "血池炼狱", w: "ming", find: { map: 6, chance: 5 },   // 冥界第 7 张图（哀嚎地狱）
      bossName: "血池之主·赤发鬼母", monsters: ["血池鬼婴", "炼狱火鬼", "血浪妖蛟", "刑狱鬼差"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "森罗殿堂", w: "ming", find: { map: 7, chance: 5 },   // 冥界第 8 张图（红莲地狱）
      bossName: "殿堂之主·森罗判官", monsters: ["森罗鬼吏", "判官笔灵", "生死簿灵", "殿前牛头"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "九幽冥海", w: "ming", find: { map: 9, chance: 5 },   // 冥界第 10 张图（无间地狱）
      bossName: "冥海之主·九幽玄蛇", monsters: ["冥海鬼鲨", "九幽水魂", "沉船怨灵", "玄蛇冥卫"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "阎罗冥宫", w: "ming", find: { map: 9, chance: 5 },   // 冥界第 10 张图（无间地狱）
      bossName: "冥宫之主·阎罗天子", monsters: ["冥宫鬼帅", "黑白无常", "马面鬼将", "阎罗铁卫"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "幽冥古界", w: "ming", find: { map: 9, chance: 5 },   // 冥界第 10 张图（无间地狱）
      bossName: "古界之主·幽冥大帝", monsters: ["幽冥古魂", "冥界巨灵", "冥火天兵", "大帝亲卫"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "黑焰魔林", w: "mo", find: { map: 0, chance: 5 },   // 魔界第 1 张图（血魔谷）
      bossName: "魔林之主·黑焰魔狼王", monsters: ["黑焰魔狼", "魔林毒蛛", "焦木魔灵", "火鸦魔"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "骷髅魔岭", w: "mo", find: { map: 1, chance: 5 },   // 魔界第 2 张图（万魔窟）
      bossName: "魔岭之主·白骨魔将", monsters: ["骷髅魔兵", "骨翼魔鹰", "魔岭尸傀", "骨刺魔蜥"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "毒瘴魔沼", w: "mo", find: { map: 3, chance: 5 },   // 魔界第 4 张图（魔焰山）
      bossName: "魔沼之主·万毒魔蟾", monsters: ["毒瘴魔蛙", "沼泽魔鳄", "腐毒魔藤", "瘴气魔灵"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "炼魂魔塔", w: "mo", find: { map: 4, chance: 5 },   // 魔界第 5 张图（骨魔荒原）
      bossName: "魔塔之主·炼魂魔师", monsters: ["塔中魂奴", "炼魂魔灯", "魔塔守卫", "怨魂魔影"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "天魔战场", w: "mo", find: { map: 6, chance: 5 },   // 魔界第 7 张图（罗刹海）
      bossName: "战场之主·天魔战神", monsters: ["天魔战士", "魔血战马", "断戟魔魂", "战场魔将"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "幽影魔城", w: "mo", find: { map: 7, chance: 5 },   // 魔界第 8 张图（阿修罗场）
      bossName: "魔城之主·幽影魔王", monsters: ["幽影刺客", "魔城卫兵", "影魔", "夜行魔蝠"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "堕仙魔域", w: "mo", find: { map: 9, chance: 5 },   // 魔界第 10 张图（魔祖天）
      bossName: "魔域之主·堕仙魔尊", monsters: ["堕落仙人", "魔化天兵", "黑羽魔使", "堕仙剑魔"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "罗睺魔殿", w: "mo", find: { map: 9, chance: 5 },   // 魔界第 10 张图（魔祖天）
      bossName: "魔殿之主·罗睺魔君", monsters: ["罗睺魔卫", "蚀日魔蛇", "魔殿祭司", "暗月魔将"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "灭世魔渊", w: "mo", find: { map: 9, chance: 5 },   // 魔界第 10 张图（魔祖天）
      bossName: "魔渊之主·灭世魔祖", monsters: ["灭世魔兵", "混沌魔兽", "魔渊巨魔", "魔祖亲卫"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "金乌神巢", w: "shen", find: { map: 0, chance: 5 },   // 神界第 1 张图（钧天）
      bossName: "神巢之主·三足金乌", monsters: ["金乌雏鸟", "日火神灵", "扶桑树灵", "神巢守卫"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "青龙神泽", w: "shen", find: { map: 1, chance: 5 },   // 神界第 2 张图（苍天）
      bossName: "神泽之主·苍青神龙", monsters: ["青鳞神蛟", "神泽水灵", "龙宫神卫", "碧涛神鲸"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "白虎神山", w: "shen", find: { map: 3, chance: 5 },   // 神界第 4 张图（玄天）
      bossName: "神山之主·白虎战神", monsters: ["白虎神兵", "金刃神灵", "山岳神猿", "庚金傀儡"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "朱雀神台", w: "shen", find: { map: 4, chance: 5 },   // 神界第 5 张图（幽天）
      bossName: "神台之主·离火朱雀", monsters: ["朱雀神卫", "离火神灵", "赤羽神鹰", "神台火将"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "玄武神渊", w: "shen", find: { map: 6, chance: 5 },   // 神界第 7 张图（朱天）
      bossName: "神渊之主·玄武真神", monsters: ["玄龟神卫", "黑水神蛇", "神渊石灵", "北冥神鲲"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "盘古神迹", w: "shen", find: { map: 7, chance: 5 },   // 神界第 8 张图（炎天）
      bossName: "神迹之主·盘古遗魂", monsters: ["开天巨灵", "神迹石人", "盘古残影", "混沌古兽"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "女娲神宫", w: "shen", find: { map: 9, chance: 5 },   // 神界第 10 张图（昊天）
      bossName: "神宫之主·补天神后", monsters: ["五彩石灵", "抟土神人", "神宫侍女", "补天神卫"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "伏羲神坛", w: "shen", find: { map: 9, chance: 5 },   // 神界第 10 张图（昊天）
      bossName: "神坛之主·八卦神皇", monsters: ["八卦神兵", "卦象之灵", "神坛祭司", "河图神龙"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
    { name: "创世神界", w: "shen", find: { map: 9, chance: 5 },   // 神界第 10 张图（昊天）
      bossName: "神界之主·创世神尊", monsters: ["创世神兵", "天道神灵", "神尊亲卫", "造化神兽"],
      extra: {
        boss: [{ item: "火髓", chance: 100, n: [5, 15] }, { item: "空间晶核", chance: 50, n: [1, 5] }, { item: "耀石", chance: 50, n: [1, 5] }],
      } },
  ],
};
