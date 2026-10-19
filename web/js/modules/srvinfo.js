/* =====================================================================
 * 模块：服务器信息（只有管理员看得到：世界 → 设置 → 管理员 → 服务器信息）
 * ---------------------------------------------------------------------
 * 查看服务器游戏程序的运行情况（版本、运行时间、内存、磁盘、数据库、在线人数、自动备份）；
 * 设置把最新备份上传到 GitHub 私有仓库：仓库、令牌、上传间隔，可手动立即上传。
 * 接口在 server/server.mjs：admin/server、admin/gh、admin/gh/upload
 * ===================================================================== */
G.module({
  id: "srvinfo",
  api: {
    openSrvInfo(on) {
      this.srvPage = !!on;
      if (on) { this.srvF = null; this.loadSrvInfo(); }
      this.render();
    },
    async loadSrvInfo() {
      try { this.srvInfo = await API.req("admin/server"); }
      catch (e) { this.log("读取服务器信息失败：" + e.message, "bad"); }
      if (this.srvInfo && !this.srvF) { const g = this.srvInfo.gh; this.srvF = { repo: g.repo || "", token: "", interval: g.interval || 0 }; }
      this.render();
    },
    srvSetIv(v) { if (this.srvF) { this.srvF.interval = v; this.render(); } },
    async srvSaveGh(clearToken) {
      const F = this.srvF; if (!F || this.srvBusy) return;
      if (clearToken && !confirm("清除已保存的 GitHub 令牌？清除后不会再自动上传。")) return;
      this.srvBusy = true; this.render();
      try {
        const j = await API.req("admin/gh", { repo: F.repo, token: F.token, interval: F.interval, clearToken: !!clearToken });
        this.srvInfo = j.info; F.token = "";
        this.log(clearToken ? "已清除 GitHub 令牌。" : "GitHub 备份设置已保存。", "gold");
      } catch (e) { this.log("保存失败：" + e.message, "bad"); }
      this.srvBusy = false; this.render();
    },
    async srvUpload() {
      if (this.srvBusy) return;
      this.srvBusy = true; this.render();
      try { const j = await API.req("admin/gh/upload", {}); this.srvInfo = j.info; this.log(`已上传 ${j.last.file}（${this.srvSize(j.last.size)}）到 GitHub。`, "gold"); }
      catch (e) { this.log("上传失败：" + e.message, "bad"); await this.loadSrvInfo(); }
      this.srvBusy = false; this.render();
    },
    srvSize(b) { b = +b || 0; return b >= 1073741824 ? (b / 1073741824).toFixed(1) + " GB" : b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(0, Math.round(b / 1024)) + " KB"; },
    srvDur(sec) { sec = Math.max(0, Math.floor(sec)); const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
      return d ? `${d} 天 ${h} 小时` : h ? `${h} 小时 ${m} 分` : `${m} 分钟`; },
    srvTime(t) { if (!t) return "—"; const d = new Date(t), z = n => String(n).padStart(2, "0");
      return `${d.getMonth() + 1}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; },
    srvInfoView() {
      const I = this.srvInfo, esc = x => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      const head = `<div class="row" style="margin:6px 0"><b>服务器信息</b><span><button class="sm" onclick="G.loadSrvInfo()">刷新</button> <button class="sm" onclick="G.openSrvInfo(false)">返回</button></span></div>`;
      if (!I) return head + `<div class="card"><p class="desc">读取中…</p></div>`;
      const L = (k, v) => `<div class="line"><div>${k}</div><div>${v}</div></div>`, S = x => this.srvSize(x);
      const p = I.players, sys = I.sys, g = I.gh, F = this.srvF || { repo: "", token: "", interval: 0 }, last = g.last;
      const prog = `<div class="card"><h3>游戏程序<small>${I.players.online} 人在线</small></h3>
        ${L("版本", esc(I.version || "未知"))}
        ${L("已运行", this.srvDur((I.now - I.startedAt) / 1000) + `<small>（${this.srvTime(I.startedAt)} 启动）</small>`)}
        ${L("Node", esc(I.node) + ` · 进程 ${I.pid}`)}
        ${L("程序内存", S(I.mem.rss) + `<small>（堆 ${S(I.mem.heap)}）</small>`)}
        ${L("账号 / 角色", `${p.users} / ${p.saves}`)}
        ${L("存档合计", S(p.total) + `<small>（最大一份 ${S(p.max)}）</small>`)}
        ${L("数据库", S(I.db.size))}</div>`;
      const host = `<div class="card"><h3>服务器<small>${esc(I.host)}</small></h3>
        ${L("系统", esc(I.platform))}
        ${L("开机时长", this.srvDur(I.osUptime))}
        ${L("CPU", `${sys.cpus} 核 · 负载 ${sys.load.map(x => x.toFixed(2)).join(" / ")}`)}
        ${L("内存", `可用 ${S(sys.free)} / 共 ${S(sys.total)}`)}
        ${I.disk ? L("磁盘", `可用 ${S(I.disk.free)} / 共 ${S(I.disk.total)}`) : ""}</div>`;
      const bk = I.backup, bkList = bk.list.map(b => `<div class="line"><div><small>${esc(b.name)}</small></div><div><small>${S(b.size)}</small></div></div>`).join("");
      const backup = `<div class="card"><h3>自动备份<small>每小时 · 保留 ${bk.keep} 份 · 现有 ${bk.count} 份</small></h3>
        ${bkList || `<p class="desc">还没有备份（服务器启动 1 分钟后生成第一份）。</p>`}<p class="desc">位置：${esc(bk.dir)}</p></div>`;
      const ivBtns = g.intervals.map(v => `<button class="sm ${F.interval === v ? "primary" : ""}" onclick="G.srvSetIv(${v})">${v ? v + " 小时" : "关闭"}</button>`).join(" ");
      const status = last ? (last.ok ? `<span class="c-green">成功</span> ${this.srvTime(last.time)} · ${esc(last.file)} · ${S(last.size)}` : `<span class="c-red">失败</span> ${this.srvTime(last.time)}：${esc(last.error)}`) : "还没上传过";
      const next = g.interval && g.repo && g.tokenSet ? (last && last.ok ? this.srvTime(last.time + g.interval * 3600000) : "1 分钟内") : "—";
      const ghCard = `<div class="card"><h3>上传到 GitHub<small>只保留最新一份</small></h3>
        <p class="desc">必须是【私有】仓库（备份里有所有账号和存档）。令牌：GitHub → Settings → Developer settings → Fine-grained tokens，只选这个仓库，Contents 选 Read and write。</p>
        <div class="row small"><span>仓库</span><input type="text" placeholder="用户名/仓库名" value="${esc(F.repo)}" oninput="G.srvF.repo=this.value" autocomplete="off" style="width:13em"></div>
        <div class="row small"><span>令牌${g.tokenSet ? `<small>（已保存 …${esc(g.tokenTail)}）</small>` : ""}</span><input type="password" placeholder="${g.tokenSet ? "不改就留空" : "粘贴令牌"}" value="${esc(F.token)}" oninput="G.srvF.token=this.value" autocomplete="new-password" style="width:13em"></div>
        <div class="row small"><span>上传间隔</span></div><div class="btns" style="flex-wrap:wrap">${ivBtns}</div>
        ${L("上次上传", status)}${L("下次上传", next)}
        <div class="btns"><button class="primary" onclick="G.srvSaveGh(false)" ${this.srvBusy ? "disabled" : ""}>保存设置</button>
          <button onclick="G.srvUpload()" ${this.srvBusy || !g.repo || !g.tokenSet ? "disabled" : ""}>${this.srvBusy ? "处理中…" : "立即备份并上传"}</button>
          ${g.tokenSet ? `<button onclick="G.srvSaveGh(true)" ${this.srvBusy ? "disabled" : ""}>清除令牌</button>` : ""}</div></div>`;
      return head + prog + host + backup + ghCard;
    },
  },
});
