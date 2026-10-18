# 问道长生：服务器权威版（测试服）

本仓库将原有浏览器游戏改为服务器权威运行：Node.js 服务端加载 `web/js/config/`、`web/js/data/`、`web/js/modules/` 与快速结算逻辑；服务器负责玩家状态、随机结果、时间推进、探索/雷劫及玩家操作校验。浏览器保留原有界面和数值展示，通过 WebSocket 接收服务器快照并发送白名单操作，不再本地结算或上传存档。

测试服使用**新的空数据库**，不导入旧存档。仓库中的部署脚本只使用 `/opt/xiu-online`、`/var/lib/xiu-online`、systemd 服务 `xiu-online-test`、端口 `18301` 和 URL 前缀 `/xiuxian-test/`，不会覆盖原版 `/opt/xiu`、`/var/lib/xiu`、`xiu-server` 或 `/xiuxian/`。Node API 只绑定本机回环地址；Nginx 提供静态网页和 API/WebSocket 反代。

## 运行测试

要求 Node.js 20 或更新版本。安装依赖并启动 API/WebSocket 服务：

```bash
cd server
npm ci
XIU_HOST=127.0.0.1 XIU_PORT=18301 XIU_DATA_DIR=./data npm start
```

健康检查：

```bash
curl http://127.0.0.1:18301/health
```

测试：

```bash
cd server
npm test
```

生产反向代理需将网页路径 `/xiuxian-test/` 指向 `web/`，并将 `/xiuxian-test/api/` 转发到 `127.0.0.1:18301/api/`，保留 WebSocket Upgrade。HTTPS 页面必须通过同源 HTTPS/WSS 访问。

## 直接用公网 IP 测试

安装完成后可访问 `http://你的公网IP/`，Nginx 会将根路径跳转到 `/xiuxian-test/`，并在同一 IP 上反代 API 和 WebSocket。安装器默认通过 `api.ipify.org` 探测公网 IPv4；若探测结果不是访问用的 IP，可在运行安装/更新时设置 `XIU_PUBLIC_IP`。例如：

```bash
curl -fsSL https://raw.githubusercontent.com/hyp3699/xiu-online/main/deploy/install.sh | sudo env XIU_PUBLIC_IP=54.252.143.152 bash
sudo env XIU_PUBLIC_IP=54.252.143.152 xiu-online-update
```

此入口为 HTTP 明文传输，只适合短期测试：请使用一次性测试账号和密码，不要使用常用密码。正式使用请配置域名和 HTTPS，再通过 HTTPS/WSS 访问。`server-url.txt` 当前指向这台测试 IP，APK 测试版也会使用明文 HTTP。

## 部署到现有 Debian/Ubuntu 服务器

确认服务器已配置 Nginx HTTPS 站点后，可用以下命令部署独立测试服：

```bash
curl -fsSL https://raw.githubusercontent.com/hyp3699/xiu-online/main/deploy/install.sh | sudo bash
```

安装器会创建新的服务和空数据库。游戏入口为 `https://你的域名/xiuxian-test/`；首次注册账号成为管理员。请尽早在管理界面关闭注册。`server-url.txt` 是 APK 构建的默认服务入口。

更新必须由管理员手动执行：

```bash
sudo xiu-online-update
```

卸载命令 `sudo xiu-online-uninstall` 只删除本仓库测试服，不会删除原版游戏或原版存档。卸载测试服的数据删除不可恢复。
