/* =====================================================================
 * 模块：数据修改（只有管理员看得到：世界 → 设置 → 管理员 → 数据修改）
 * ---------------------------------------------------------------------
 * 直接修改 js/config/ 里的参数文件。点保存后服务器先用新参数完整加载一遍，
 * 没有错误才保存并立即生效；在线玩家的网页会自动重新加载新参数。
 * 改过的文件存在服务器数据目录（不会被「从 GitHub 更新」覆盖），可以「恢复默认」。
 * 接口在 server/server.mjs：admin/config、admin/config/file、admin/config/save、admin/config/reset
 * ===================================================================== */
G.module({
  id: "cfgedit",
  api: {
    cfgEsc(x) { return String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
    // 打开文件列表
    async openCfgEdit() {
      this._cfgOpen = true; this._lockModal = true; this._cfgFile = null;
      this.modal(`<h2>数据修改</h2><p>读取中…</p>`);
      try { const j = await API.req("admin/config"); this._cfgList = j.list || []; }
      catch (e) { this._cfgList = []; this.cfgMsg = "读取失败：" + e.message; }
      this.cfgListView();
    },
    cfgListView() {
      const L = this._cfgList || [];
      this.modal(`<h2>数据修改</h2><p class="desc">选择要修改的参数文件（js/config/）。标「已修改」的是改过的版本，可恢复默认。</p>
        ${this.cfgMsg ? `<p class="c-red">${this.cfgEsc(this.cfgMsg)}</p>` : ""}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0">
        ${L.map(f => `<button class="sm" onclick="G.cfgOpenFile('${f.name}')">${f.name}${f.overridden ? ` <b class="c-green">已修改</b>` : ""}</button>`).join("")}</div>
        <div class="btns"><button onclick="G.cfgClose()">关闭</button></div>`);
      this.cfgMsg = "";
    },
    async cfgOpenFile(name) {
      this.modal(`<h2>${this.cfgEsc(name)}</h2><p>读取中…</p>`);
      try {
        const j = await API.req("admin/config/file?name=" + encodeURIComponent(name));
        this._cfgFile = { name: j.name, overridden: j.overridden };
        this.modal(`<h2>${this.cfgEsc(j.name)}${j.overridden ? ` <small class="c-green">已修改</small>` : ""}</h2>
          <p class="desc">改完点「保存」，服务器检查无误后立即使用新参数。</p>
          <textarea id="cfg-text" spellcheck="false" autocapitalize="off" autocomplete="off" style="width:100%;height:58vh;background:#14110f;color:#e8dcc4;border:1px solid #4a3d31;border-radius:4px;padding:8px;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.5;white-space:pre;overflow:auto;tab-size:2">${this.cfgEsc(j.content)}</textarea>
          <p id="cfg-msg" class="desc" style="margin-top:6px"></p>
          <div class="btns"><button class="primary" id="cfg-save" onclick="G.cfgSave()">保存</button>
          ${j.overridden ? `<button onclick="G.cfgReset()">恢复默认</button>` : ""}
          <button onclick="G.cfgBack()">返回</button></div>`);
      } catch (e) { this.cfgMsg = "读取失败：" + e.message; this.cfgListView(); }
    },
    cfgSetMsg(text, bad) { const el = document.getElementById("cfg-msg"); if (el) { el.textContent = text; el.className = bad ? "c-red" : "c-green"; } },
    async cfgSave() {
      const f = this._cfgFile, ta = document.getElementById("cfg-text"); if (!f || !ta) return;
      const btn = document.getElementById("cfg-save"); if (btn) btn.disabled = true;
      this.cfgSetMsg("保存中…");
      try {
        await API.req("admin/config/save", { name: f.name, content: ta.value });
        f.overridden = true; this._cfgReload = true;
        this.cfgSetMsg("已保存，服务器已使用新参数。关闭窗口后页面会重新加载。");
        API.showActionFeedback("参数已保存");
      } catch (e) { this.cfgSetMsg(e.message, true); API.showActionFeedback("保存失败", "bad"); }
      if (btn) btn.disabled = false;
    },
    async cfgReset() {
      const f = this._cfgFile; if (!f || !confirm(`把 ${f.name} 恢复成默认参数？改过的内容会丢失。`)) return;
      try { await API.req("admin/config/reset", { name: f.name }); this._cfgReload = true; API.showActionFeedback("已恢复默认"); this.cfgOpenFile(f.name); }
      catch (e) { this.cfgSetMsg(e.message, true); }
    },
    async cfgBack() { this._cfgFile = null; await this.openCfgEdit(); },
    cfgClose() {
      this._cfgOpen = false; this._lockModal = false; this._cfgFile = null; this.closeModal();
      if (this._cfgReload) { this._cfgReload = false; location.reload(); }
    },
  },
});
