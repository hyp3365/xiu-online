/* =====================================================================
 * ★ 自定义物品 · 坊市 · 宗门宝库 ★
 * ---------------------------------------------------------------------
 * 这个文件不是数值文件：在这里可以
 *   1. list      添加杂物（名字、说明、出售价）
 *   2. shop      设置坊市卖什么（修炼丹、装备，可以删、改价格）
 *   3. treasury  设置宗门宝库「杂物」页兑换什么（炉子、灵石、秘法）
 * 改完把 index.html 里的 ?v=数字 加 1。
 * 物品名字就是物品的 id，不要重名；已经发给玩家的物品改名后，玩家背包里的会变成「失传之物」。
 * ===================================================================== */
window.ITEMS = {};

/* ---------------- 1. 物品 ----------------
 * 写法："名字": { type: "misc", q: 颜色, desc: 说明, sell: 出售灵石(0 = 不能出售) }
 *   type 只有 "misc" 杂物：放在背包里，只能出售，或被别的系统按名字消耗（如肉身突破）
 *   q 颜色等级 0~5（背包、名字的颜色，和装备属性颜色同一套 q0~q5）
 *   img 图片（可不写）：如 "img/icons/cu_misc.png"，不写用 cu_misc.png
 * 发放：地图 fixed 掉落（config/drops.js）、秘境 / 灵地 extra 掉落（config/mijing.js、config/lingdi.js）里写这里的物品名就会掉落。
 */
ITEMS.list = {
  // 肉身突破用的仙界 / 冥界 / 魔界药材（config/body.js 的 HERBS_XIAN；以后开放这三界时加进地图掉落）
  "九天仙芝": { type: "misc",  q: 3, desc: "仙界灵药，散仙以上肉身突破所需。仙界掉落。", sell: 100 },
  "瑶池玉莲": { type: "misc",  q: 3, desc: "仙界灵药，散仙以上肉身突破所需。仙界掉落。", sell: 100 },
  "彼岸花":   { type: "misc",  q: 3, desc: "冥界灵药，散仙以上肉身突破所需。冥界掉落。", sell: 100 },
  "黄泉冥草": { type: "misc",  q: 3, desc: "冥界灵药，散仙以上肉身突破所需。冥界掉落。", sell: 100 },
  "魔血藤":   { type: "misc",  q: 3, desc: "魔界灵药，散仙以上肉身突破所需。魔界掉落。", sell: 100 },
  "噬魂魔果": { type: "misc",  q: 3, desc: "魔界灵药，散仙以上肉身突破所需。魔界掉落。", sell: 100 },
};

/* ---------------- 2. 坊市 ----------------
 * 每一行一种货品，从上到下显示，删掉一行就不卖了：
 *   { kind: "pill", type: "juqi" }        修炼丹（juqi 聚气丹 / juling 聚灵丹 / peiyuan 培元丹），品质 = 当前境界，价格自动
 *   { kind: "eq", slot: "weapon" }        一阶炼器装备（随机属性），slot 只能是 helmet armor weapon legs boots pendant（坊市不卖戒指）
 *   任意一行都可以加：price 固定价格（覆盖自动价格）  realm 需要的境界序号（0 练气 1 筑基 …，不够就不显示）
 */
ITEMS.shop = [
  { kind: "pill", type: "juqi" , price: 100 },
  { kind: "pill", type: "juling", price: 400 },
  { kind: "pill", type: "peiyuan", price: 900 },
  { kind: "eq", slot: "helmet", price: 2000 },
  { kind: "eq", slot: "armor", price: 2000 },
  { kind: "eq", slot: "weapon", price: 2000 },
  { kind: "eq", slot: "legs", price: 2000 },
  { kind: "eq", slot: "boots", price: 2000 },
  { kind: "eq", slot: "pendant", price: 2000 },
];

/* ---------------- 3. 宗门宝库 · 杂物 ----------------
 * 每一行一种，cost = 贡献（不乘星级），star = 需要门派星级（不写 = 1 星起）：
 *   { kind: "furnace", fk: "dan", g: 0, cost: 100 }   炉子（dan 炼丹炉 / qi 炼器炉，g 阶序号 0 = 一阶）
 *   { kind: "stone", n: 2000, cost: 100, name: "一袋灵石" }  灵石 n × 灵石成长^层序
 *   { kind: "pill", type: "juqi", cost: 50 }          修炼丹（当前境界品质）
 *   { kind: "chuqiao" }                               元婴出窍秘法（数值在 config/sect.js 的 CFG.chuqiao）
 * 这里写了就以这里为准；把整个 ITEMS.treasury 删掉，则用 config/sect.js 里的 treasury。
 */
ITEMS.treasury = [
  { kind: "furnace", fk: "dan", g: 0, cost: 100 },
  { kind: "furnace", fk: "qi",  g: 0, cost: 100 },
  { kind: "stone", n: 50, cost: 100, name: "一袋灵石" },
  { kind: "chuqiao" },   // 元婴出窍秘法：消耗、效果、境界限制在 config/sect.js 的 CFG.chuqiao
];
