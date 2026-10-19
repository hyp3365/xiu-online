/* =====================================================================
 * ★ 数值设置 · 门派 ★（代码：modules/sect.js、data/sects.js）
 * 大殿职务与俸禄、事务堂、修炼室、练功房、练体池、试炼塔、宗门秘境、宝库、晋升考验、元婴出窍、宗主清灵丹 / 传承功法
 * 星级倍率 = STAR_MULT[门派星级-1]；职务倍率 = RANK_MULT[职务序号]
 * 职务序号：0 外门 1 内门 2 真传 3 核心 4 长老 5 供奉 6 宗主
 * 境界序号：0 练气 1 筑基 2 金丹 3 元婴 4 出窍 5 化神 6 练虚 7 合体 8 洞真 9 大乘 10 渡劫 11 散仙
 *   12 游仙 13 地仙 14 天仙 15 金仙 16 太乙金仙 17 大罗金仙 18 玄仙 19 仙君 20 帝仙 21 准圣 22 天道圣人 23 大道圣人
 * ===================================================================== */
window.CFG = window.CFG || {};

CFG.sect = {
  LEAVE_COST: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000],   // 叛出门派扣贡献：1 星 ~ 10 星门派（不够不能叛出）
  STAR_MULT: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],   // 星级倍率：1 星 ~ 10 星门派
  RANK_MULT: [1, 1, 1, 1, 1, 1, 1],             // 职务倍率（俸禄、事务堂奖励）：按职务序号
  // 大殿职务（逐级晋升，先过晋升考验）：cost 晋升贡献 × 星级倍率；daily 每日俸禄灵石 × 星级倍率 × 职务倍率
  //   需要境界：外门 = REQ_REALM，其余见 config/mobs.js 的 sect 考官
  ranks: [
    { name: "外门弟子", cost: 0,      daily: 1000 },
    { name: "内门弟子", cost: 200,    daily: 2000 },
    { name: "真传弟子", cost: 500,   daily: 3000 },
    { name: "核心弟子", cost: 800,   daily: 4000 },
    { name: "宗门长老", cost: 1200,  daily: 5000 },
    { name: "宗门供奉", cost: 2000,  daily: 6000 },
    { name: "宗主",     cost: 3000, daily: 8000 },
  ],
  // 事务堂（自动循环，离线继续）：rank 最低职务序号  time 每次分钟  contrib / stone 每次奖励 × 星级倍率 × 职务倍率
  affair: {
    tasks: [
      { name: "打扫山门",     rank: 0, time: 5,   contrib: 5,   stone: 5 },
      { name: "护送商队",     rank: 1, time: 5,  contrib: 8,  stone: 8 },
      { name: "镇守灵脉",     rank: 2, time: 5,  contrib: 12,  stone: 12 },
      { name: "斩杀魔修",     rank: 3, time: 5,  contrib: 16,  stone: 16 },
      { name: "传功讲道",     rank: 4, time: 5,  contrib: 20, stone: 20 },
      { name: "镇压魔窟",     rank: 5, time: 5,  contrib: 25, stone: 25 },
      { name: "统御宗门",     rank: 6, time: 5, contrib: 30, stone: 30 },
    ],
  },
  // 修炼室：pct 修为修炼速度 +% × 星级倍率  cost 每 10 秒贡献（不乘倍率）  rank 需要职务序号（不写 = 所有人）
  rooms: [
    { name: "下品修炼室", pct: 20,  cost: 1 },
    { name: "中品修炼室", pct: 30,  cost: 2 },
    { name: "上品修炼室", pct: 50, cost: 4 },
    { name: "天品修炼室", pct: 80, cost: 6 },
    { name: "宗主修炼室", pct: 120, cost: 1, rank: 6 },
  ],
  SECRET_COST: 200,  // 宗门秘境每次贡献 = SECRET_COST × 门派星数（不读 STAR_MULT）
};

// 门派入门境界序号：1 星 ~ 10 星；同星级坊市功法 / 法术、试炼塔守关者也用
CFG.sect.REQ_REALM = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18];
// 宗门秘境：掷一次，按 stone → pill → equip 顺序累计 chance，都不中则一无所获
CFG.sect.secret = {
  stone: { chance: 0.4, mult: 30 },          // 灵石 = mult × 星级倍率 × 随机(1~2)
  pill:  { chance: 0.35, n: [2, 5] },        // 当前境界随机修炼丹，n 枚数范围
  equip: { chance: 0.15 },                   // 随机装备 / 戒指 / 法宝，阶 = 门派星级
};

/* 试炼塔（守关者属性见 config/mobs.js 的 tower）；进度按星级记录
 * 每层首通给 floor；每 EVERY 层：RING ≥ 0 的星级第 1 次给该戒指、之后给二~十阶图纸；MIJUE 设置的层给秘诀；其余给 EXTRA 三选一
 * 下面数组都是 1 星 ~ 10 星 */
CFG.sect.trial = {
  FLOORS: [100, 150, 200, 250, 300, 350, 400, 450, 500, 550],   // 总层数
  EVERY: 10,   // 每几层一次额外奖励
  RING: [0, 1, 2, -1, -1, -1, -1, -1, -1, -1],   // 戒指：0 破军 1 磐石 2 长生 3 灵犀 4 疾风 5 鹰眼 6 幻影 7 烈阳 8 玄武，-1 = 不给
  floor: {
    contrib: [1, 1, 1, 1, 1, 1, 2, 2, 2, 2],   // 贡献 = contrib × 层数
    fire:  [1, 1, 1, 1, 2, 2, 2, 3, 3, 3],     // 火髓（固定数）
    stone: 1,                                 // 灵石 = stone × 星级倍率 × 层数
    herb:  [2, 3, 4, 5, 6, 7, 8, 9, 10, 12],   // 随机药材数量
    ore:   [2, 3, 4, 5, 6, 7, 8, 9, 10, 12],   // 随机矿石数量
    MAT_MAX: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],   // 药材矿石从第 0 种随机到第几种（最多 5）
  },
  // 试炼塔秘诀（修炼秘诀）：每 EVERY 层给一本（0 = 不按间隔），效果 = 宗门同星级秘诀 × PCT%；最后一层另给一本 × LAST%（0 = 不给）
  MIJUE: {
    EVERY: [0, 0, 50, 50, 50, 50, 50, 50, 50, 50],
    PCT:   [0, 0, 160, 160, 160, 160, 160, 160, 160, 160],
    LAST:  [0, 180, 200, 200, 200, 200, 200, 200, 200, 200],
  },
  // 其余额外奖励层：三种随机一种，数量 [最少, 最多]
  EXTRA: {
    fire:  [[50, 75], [75, 100], [100, 125], [125, 150], [150, 175], [175, 200], [200, 225], [225, 250], [250, 275], [275, 300]],   // 火髓
    ys:    [[50, 75], [75, 100], [100, 125], [125, 150], [150, 175], [175, 200], [200, 225], [225, 250], [250, 275], [275, 300]],   // 耀石（随机属性）
    merit: [[100, 140], [140, 180], [180, 220], [220, 260], [260, 300], [300, 340], [340, 380], [380, 420], [420, 460], [460, 500]],   // 功德
  },
};

// 练功房：pct 功法修炼时间 −%（不乘星级，最多 95）  cost 每 5 秒贡献（不乘倍率，只在修炼功法时扣）  rank 需要职务序号
CFG.sect.gfRooms = [
  { name: "下品练功房", pct: 18, cost: 1 },
  { name: "中品练功房", pct: 24, cost: 2 },
  { name: "上品练功房", pct: 32, cost: 3 },
  { name: "天品练功房", pct: 40, cost: 4 },
  { name: "宗主练功房", pct: 40, cost: 2, rank: 6 },
];
// 晋升考验（考官属性见 config/mobs.js 的 sect）：每次消耗贡献 = cost[目标职务序号] × 星级倍率，输赢都扣
CFG.sect.rankTrial = {
  cost: [0, 50, 100, 150, 200, 300, 500],
};

// 事务堂 · 物品任务 / 特殊任务（每天北京时间 0 点重置，每个任务完成一次）
CFG.sect.affairItem = {
  HERB: 3, ORE: 3,                 // 药材任务、矿石任务各几个（每个任务只要一种）
  FAN_STAR: 5,                     // 宗门 ≤ 这个星级交凡界药材矿石，以上交四界通用药材矿石
  N: [[30, 50], [70, 100]],        // 要交的数量：[几率%, 个数]
  CONTRIB: 100, RANK_ADD: 25,      // 奖励贡献 = CONTRIB + 职务序号 × RANK_ADD（不看星级）
};
CFG.sect.affairFight = {
  // 前 3 个 = 入门境界，后 3 个 = 入门境界的下一个境界；lay 怪物层 pct 宗门功法学% gf 功法层，都是 [最小, 最大] 随机
  GROUPS: [
    { n: 3, realm: 0, lay: [1, 5],  pct: [1, 20],  gf: [1, 3], mul: 1 },
    { n: 3, realm: 1, lay: [6, 10], pct: [21, 50], gf: [3, 6], mul: 2 },
  ],
  // 胜利奖励 × mul（灵石再 × 宗门星级）；失败扣 × 宗门星级 × mul（可以扣成负数）；赢了才算完成，输了可以再打
  WIN: { stone: 1000, contrib: 300 },
  LOSE: { stone: 200, contrib: 50 },
  CRIT: 5,                         // 怪物暴击%
};

/* 练体池：每天 DAILY 次，每次 MINUTES 分钟，泡完永久加肉身属性
 * 进入扣：贡献 contrib × 本池 STAR_MULT[宗门星级-1]（不读宗门通用 STAR_MULT）；扣肉身气血 hp 点
 * keys 加哪些属性（hp atk def dodge res hit mana crit）；rank 需要职务序号
 * 每次加 = round(GAIN[池序号][j] × STAR_GAIN^(宗门星级-1)) ± 随机 RAND，GAIN 每行顺序同该池 keys */
CFG.sect.pool = {
  name: "练体池",   
  MINUTES: 60,
  DAILY: 1,
  STAR_MULT: [1, 1.5, 2.5, 4, 6, 9, 13, 18, 25, 35],   // 1 星 ~ 10 星宗门
  list: [
    { name: "免费练体池", contrib: 0,   hp: 75000,  keys: ["hp"] },
    { name: "下品练体池", contrib: 100,  hp: 150000, keys: ["hp", "def"] },
    { name: "中品练体池", contrib: 200, hp: 300000, keys: ["hp", "def", "atk"] },
    { name: "上品练体池", contrib: 300, hp: 600000, keys: ["hp", "def", "atk", "dodge"] },
    { name: "天品练体池", contrib: 400, hp: 1200000, keys: ["hp", "def", "atk", "dodge", "res", "hit"] },
    { name: "宗主练体池", contrib: 100, hp: 1500000, keys: ["hp", "def", "atk", "dodge", "res", "hit"], rank: 6 },
  ],
  STAR_GAIN: 1.2,
  RAND: 3,
  GAIN: [   // 行 = 上面 list 的池子（免费 下品 中品 上品 天品 宗主）
    [50],
    [50, 21],
    [50, 21, 28],
    [50, 23, 28, 18],
    [60, 25, 31, 19, 18, 23],
    [60, 25, 31, 19, 18, 23],
  ],
};

// 免费修炼室 / 练功房（每天北京时间 0 点重置，不扣贡献）：pct 写 0 = 同最低一档；修炼室 pct × 星级倍率，练功房不乘
CFG.sect.freeRoom   = { name: "免费修炼室", pct: 0, times: 500, daily: 1 };   // 每天 daily 次，每次 times 次修炼（每次 10 秒）
CFG.sect.freeGfRoom = { name: "免费练功房", pct: 15, minutes: 60, daily: 1 };  // 每天 daily 次，每次 minutes 分钟

// 元婴出窍秘法：宝库兑换；每天出窍次数 = 神识强度（config/shenshi.js）
CFG.chuqiao = {
  NAME: "元婴出窍秘法",
  LEARN_CONTRIB: 3000,   // 兑换贡献（不乘星级）
  LU_MJ_REALM: 3, LU_DROP: 10,            // 境界为 LU_MJ_REALM 的秘境每次必掉 LU_DROP 个养神露
  REALM: 3,        // 兑换、出窍需要的境界序号
  STAR: 1,         // 兑换需要的门派星级
};

/* 宗主清灵丹：大殿每天领 1 颗，名字 = 门派名 + NAME；永久加 STATS
 * 每颗数值 = CAT 类（0 凡丹 / 1 仙丹）第 TIER 阶同属性丹（config/alchemy.js）；每个门派最多服 LIMIT 颗；数组 1 星 ~ 10 星 */
CFG.sect.qingling = {
  NAME: "清灵丹",
  STATS: ["hp", "atk", "def", "mana"],
  TIER: [2, 4, 6, 8, 10, 2, 4, 6, 8, 10],
  CAT:  [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
  LIMIT: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
};

/* 宗主传承功法：每门派一套，每天领悟 1 本；名字 = 门派名 + WORD + NAME[类别]，法术 = 门派名 + WORD + SPELL
 * 效果 = 同星级宗门功法 × PCT%；学习贡献 = 同星级宗门功法 × LEARN 倍 */
CFG.sect.chuancheng = {
  WORD: "传承",
  TYPES: ["gongjue", "xinfa", "zhenjing", "fajue"],   // 有哪几类功法（另加一本法术）
  NAME: { gongjue: "攻诀", xinfa: "心法", zhenjing: "真诀", fajue: "法诀" },
  SPELL: "神通",
  PCT: 150,
  LEARN: 2,
};
