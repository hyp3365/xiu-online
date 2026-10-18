/* =====================================================================
 * 模块：账号（登录 / 注册 / 开局创建角色）
 * ---------------------------------------------------------------------
 * 流程：
 *   1. 打开网页 → 有登录令牌就直接向服务器取存档
 *   2. 没有令牌或令牌失效 → 弹出登录框
 *   3. 服务器没有存档 → 进入“踏入仙途”创建角色
 *   4. 读到存档 → 补算离线收益 → 开始游戏
 * ===================================================================== */
G.module({
  id: "account",

  api: {
    loginForm(msg) {
      this._lockModal = true; document.body.classList.add("nologin");   // 未登录：只显示登录框
      this.modal(`<h2>问道长生</h2><p>${msg || "登录后存档保存在服务器，随时随地继续修仙。"}</p>
        <p><input id="lg-user" maxlength="20" placeholder="账号（字母、数字或中文）" value="${API.user || ""}"></p>
        <p><input id="lg-pass" type="password" maxlength="64" placeholder="密码（至少 6 位）"></p>
        <p id="lg-err" class="q5"></p>
        <div class="btns"><button class="primary" onclick="G.doLogin(false)">登录</button><button onclick="G.doLogin(true)">注册新账号</button></div>`);
    },
    async doLogin(isReg) {
      const u = $("#lg-user").value.trim(), p = $("#lg-pass").value;
      const err = t => { $("#lg-err").textContent = t; };
      if (!u || p.length < 6) return err("请填写账号，密码至少 6 位。");
      try {
        if (isReg) await API.register(u, p); else await API.login(u, p);
        if (this.s) return location.reload(); // 游戏中途掉线重登，刷新即可
        this.enterGame();
      } catch (e) { err(e.message); }
    },
    async showLogin() {
      if (!API.token) return this.loginForm();
      this.enterGame();
    },
    async enterGame() {
      let data;
      try { data = await API.loadSave(); }
      catch (e) {
        if (/登录/.test(e.message)) { API.logout(); return this.loginForm("登录已过期，请重新登录。"); }
        return this.loginForm("连接服务器失败：" + e.message);
      }
      this._lockModal = false; this.closeModal();
      if (!data) return this.intro();
      this.s = this.migrate(data);
      this.fabaoNames();   // 法宝名字跟着 config/names.js
      this.offline();
      document.body.classList.remove("nologin");
      this.start();
    },
    relogin() { API.logout(); this.loginForm("登录已过期，请重新登录（进度已保存在本机，登录后会同步）。"); },
    logout() {
      this.save(true);
      setTimeout(() => { API.logout(); location.reload(); }, 500);
    },
    restart() {
      if (!confirm("确定删除这个账号的存档，从头开始？")) return;
      this._stopped = true;
      localStorage.removeItem("xiu_local_" + API.user);
      API.upload(null).then(() => location.reload());
    },

    // 创建角色（不再随机灵根；灵根在「灵根」页用灵石提升）
    intro() {
      this._lockModal = true;
      this.modal(`<h2>踏入仙途</h2><p>凡人寿不过百，你于山野间偶得一卷残破古经，自此心生问道之念。</p>
        <p>道号<input id="name-input" maxlength="8" placeholder="例如：青云子"></p>
        <div class="btns"><button class="primary" id="start-btn">开始修仙</button></div>`);
      $("#start-btn").onclick = () => {
        const name = ($("#name-input").value || "").trim() || "无名散修";
        this.s = this.newSave(name);
        this._lockModal = false; this.closeModal(); document.body.classList.remove("nologin");
        this.dirty(); const st = this.stats(); this.s.hp = st.hp; this.s.mana = st.mana;
        this.log(`${name}，自此踏上仙途。赠你聚气丹三枚、${CFG.start.book ? CFG.start.book.name : "练气诀"}一本。`, "gold");
        this.log("提示：修炼页开启“自动修炼”，聚灵阵会为你聚集灵气；离线也会继续修炼。", "sys");
        this.start();
      };
    },
  },
});
