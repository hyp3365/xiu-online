/* =====================================================================
 * 数据：仙魔冥神 坊市功法、功德司功法（每张地图一个坊市、一个功德司，四界共 40 张图）
 * ---------------------------------------------------------------------
 * 每处每类功法一本（含肉身秘诀，没有法术）；名字 = 地图名 + 后缀（梵度天秘诀 / 梵度天功德秘诀）
 * 星级：每界第 1、2 张图 6 星，3、4 张 7 星 …… 9、10 张 10 星
 * 属性（金木水火土雷）：每类功法在 40 张图里平均分配、打乱顺序（固定，每次一样）
 * 效果、价格见 config/gongfa.js 的 jshop / gd；id：坊市 j地图序号，功德司 d地图序号
 * ===================================================================== */
DATA.JIE_GF_WORLDS = ["xian", "mo", "ming", "shen"];
DATA.jieGf = { jshop: [], gd: [] };
(() => {
  const word = DATA.nmPick(CFG.names, "gdGfWord", "功德");
  for (const [kind, pre] of [["jshop", "j"], ["gd", "d"]]) {
    const list = DATA.jieGf[kind];
    DATA.JIE_GF_WORLDS.forEach(w => (DATA.worldMapIdx[w] || []).forEach((a, i) => {
      const m = DATA.maps[a];
      list.push({ id: pre + a, src: kind, map: a, w, star: Math.min(10, 6 + Math.floor(i / 2)), plain: true,
        prefix: m.name + (kind === "gd" ? word : ""), name: m.name + (kind === "gd" ? "功德司" : "坊市"), reqRealm: DATA.mapReq(a), els: {} });
    }));
    DATA.gongfaTypes.forEach(t => {   // 属性平均分配后打乱
      const seq = list.map((_, i) => DATA.elements[i % 6].id);
      let h = 7; for (const c of kind + t.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      for (let i = seq.length - 1; i > 0; i--) { h = (h * 1103515245 + 12345) >>> 0; const j = h % (i + 1); [seq[i], seq[j]] = [seq[j], seq[i]]; }
      list.forEach((o, i) => { o.els[t.id] = seq[i]; });
    });
    list.forEach(o => { o.el = o.els.mijue; DATA.gfSrcById[o.id] = o; });
  }
})();
DATA.jieGfOf = (kind, a) => DATA.gfSrcById[(kind === "gd" ? "d" : "j") + a];
