/* =====================================================================
 * 数据：装备 & 法宝
 * ---------------------------------------------------------------------
 * 炼制装备 / 戒指 / 法宝见 data/forge.js。
 * 装备栏：头盔 护甲 武器 腿甲 靴 吊坠 + 6 个戒指
 * 法宝栏、法术栏：每个大境界开启 1 格，最多 12 格（练气 1 格、筑基 2 格……）
 * ===================================================================== */
// 物品部位（slot）：装备 + 法宝
DATA.slots = { helmet: "头盔", armor: "护甲", weapon: "武器", legs: "腿甲", boots: "靴", pendant: "吊坠", ring: "戒指", fabao: "法宝" };
for (const k in DATA.slots) DATA.slots[k] = DATA.nmPick(CFG.names.slot, k, DATA.slots[k]);   // 名字在 config/names.js 的 slot
// 装备栏位（ring0~ring5 都放戒指）
DATA.equipSlots = ["helmet", "armor", "weapon", "legs", "boots", "pendant", "ring0", "ring1", "ring2", "ring3", "ring4", "ring5"];
DATA.slotOf = key => key.startsWith("ring") ? "ring" : key; // 栏位 → 部位
DATA.SLOT_MAX = CFG.equip.SLOT_MAX;
DATA.SLOT_EVERY = CFG.equip.SLOT_EVERY || 1;   // 每隔几个大境界开 1 格
DATA.slotRealm = i => i * DATA.SLOT_EVERY;     // 第 i 格（0 起）开启的大境界 // 法宝栏、法术栏最多格数（config/equip.js）

// 背包
DATA.BAG_START = CFG.bag.START; // 储物格初始数量（config/items.js 的 bag.START）
