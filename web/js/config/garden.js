/* =====================================================================
 * ★ 灵药园 · 灵田 ★ 代码见 js/data/craft.js
 * 第 n 块灵田灵石 = floor(OPEN_COST × OPEN_RATE^(n−1))
 * 成熟时间 = grow × (1 − 缩短%/100)，缩短% = 灵植夫/仙植师 GROW_CUT + 秘法「育灵」+ 道童，上限 config/wudao.js TIME_CUT_MAX.plantTime
 * 每季数量 = floor(yield 随机 × (1 + 增产%/100))，增产% = 灵植夫/仙植师 YIELD_ADD + 秘法「丰灵」
 * ===================================================================== */
window.CFG = window.CFG || {};

CFG.garden = {
  MAX: 20,            // 最多灵田块数
  OPEN_COST: 1000,    // 开第 1 块灵田的灵石
  OPEN_RATE: 1.5,     // 每多开一块灵石 × 此倍率
  // 药材名: { grow 成熟（分钟）, yield [最少, 最多] 每季收获, ling 每季开始时扣的灵气, seed 宗门宝库兑换种子的贡献（一次永久） }
  // 药材名须与 config/items.js 的 mats.herb / matsOther.herb 一致；没写的药材按 grow 60、yield [1,1]、ling 0、seed 100；各界特色药材不能种
  herbs: {
    // 凡界：种子不限门派星级，按灵植夫加成
    青灵草: { grow: 1200, yield: [40, 60], ling: 50000, seed: 100 },
    凝露花: { grow: 1200, yield: [40, 60], ling: 50000, seed: 200 },
    赤血参: { grow: 1200, yield: [35, 55], ling: 50000, seed: 450 },
    紫灵芝: { grow: 1320, yield: [35, 55], ling: 80000, seed: 800 },
    幽冥花: { grow: 1320, yield: [30, 50], ling: 80000, seed: 1250 },
    星辰草: { grow: 1320, yield: [30, 50], ling: 90000, seed: 1800 },
    // 仙界通用：门派达 config/items.js matsOther.STAR 星才能兑换种子，按仙植师加成
    天元草:   { grow: 1800, yield: [30, 50], ling: 150000, seed: 5000 },
    玄霜花:   { grow: 1800, yield: [30, 50], ling: 150000, seed: 6000 },
    紫府灵根: { grow: 1800, yield: [25, 45], ling: 180000, seed: 8000 },
    万年雪莲: { grow: 1980, yield: [25, 45], ling: 210000, seed: 10000 },
    星河藤:   { grow: 1980, yield: [20, 40], ling: 210000, seed: 12000 },
  },
};
