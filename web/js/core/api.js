/* =====================================================================
 * 核心：与服务器通讯（账号 & 云存档）
 * ---------------------------------------------------------------------
 * 接口都在 server/server.py：
 *   POST /api/register  {username, password}       → {token}
 *   POST /api/login     {username, password}       → {token}
 *   GET  /api/save      (Header: X-Token)          → {data, updated, sid}  每次进入游戏发新会话号 sid
 *   POST /api/save      (Header: X-Token, X-Sess) 请求体 = 存档 JSON 文本 → {ok}；在别的设备进入过游戏（sid 过期）→ 409
 * 登录令牌 token 保存在浏览器 localStorage，存档本体在服务器。
 * ===================================================================== */
const API = {
  BASE: "api/", // 相对路径：网页在 /xiuxian/ 下时，接口就是 /xiuxian/api/
  token: localStorage.getItem("xiu_token") || "",
  user: localStorage.getItem("xiu_user") || "",
  sid: "",   // 本次进入游戏的会话号

  async req(path, body, method) {
    const opt = { method: method || (body ? "POST" : "GET"), headers: { "Content-Type": "application/json" } };
    if (this.token) opt.headers["X-Token"] = this.token;
    if (this.sid) opt.headers["X-Sess"] = this.sid;
    if (body !== undefined && body !== null) opt.body = typeof body === "string" ? body : JSON.stringify(body);   // 字符串 = 已经是 JSON（存档）
    const r = await fetch(this.BASE + path, opt);
    const j = await r.json().catch(() => ({ error: "服务器无响应" }));
    if (!r.ok) { const e = new Error(j.error || "请求失败 " + r.status); e.status = r.status; throw e; }
    return j;
  },

  setLogin(user, token) {
    this.user = user; this.token = token;
    localStorage.setItem("xiu_user", user); localStorage.setItem("xiu_token", token);
  },
  logout() {
    this.token = ""; localStorage.removeItem("xiu_token");
  },

  async register(u, p) { const j = await this.req("register", { username: u, password: p }); this.setLogin(u, j.token); },
  async login(u, p) { const j = await this.req("login", { username: u, password: p }); this.setLogin(u, j.token); },
  async loadSave() { const j = await this.req("save"); this.sid = j.sid || ""; return j.data; },
  async upload(str) { return this.req("save", str || "null"); },   // str = 存档 JSON 文本（和本地备份同一份，不再重复转换）；空 = 删档
  // 管理员：查看版本 / 从 GitHub 更新游戏
  async adminInfo() { return this.req("admin"); },
  async adminUpdate() { return this.req("admin/update", {}); },
  // 礼包码：管理员生成 / 列表 / 删除；所有人兑换
  async giftList() { return this.req("admin/gifts"); },
  async giftCreate(d) { return this.req("admin/gift", d); },
  async giftDelete(code) { return this.req("admin/gift/del", { code }); },
  async giftRedeem(code) { return this.req("gift", { code }); },
  async changePassword(oldPw, newPw) { return this.req("password", { old: oldPw, new: newPw }); },
  // 账号管理（管理员）：账号列表 / 开关注册 / 删除账号
  async userList() { return this.req("admin/users"); },
  async setRegOpen(open) { return this.req("admin/reg", { open }); },
  async userDelete(id) { return this.req("admin/user/del", { id }); },

  // 关闭页面时用 sendBeacon 尽量把最后的进度发出去
  beacon(str) {
    if (!this.token || !navigator.sendBeacon || !str) return;
    navigator.sendBeacon(this.BASE + "save?t=" + encodeURIComponent(this.token) + "&s=" + encodeURIComponent(this.sid), new Blob([str], { type: "application/json" }));
  },
};
