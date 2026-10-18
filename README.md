# 问道长生：服务器权威版（测试服）

本仓库将原有浏览器游戏改为服务器权威运行：Node.js 服务端加载现有配置、数据、模块和快速结算逻辑；服务器负责玩家状态、随机结果、时间推进、探索/雷劫及玩家操作校验。浏览器只显示服务器状态并通过 WebSocket 提交操作，不再本地结算或上传存档。所有新版角色数据保存在服务器的 SQLite 数据库中，自动保存；本测试服使用新空数据库，不导入旧存档。

## 部署、访问与运维速查

当前测试服务器公网 IPv4：`54.252.143.152`。安装完成后可直接访问：

- 游戏根入口：<http://54.252.143.152/>（自动跳转到测试服）
- 测试服页面：<http://54.252.143.152/xiuxian-test/>

### 安装

在 Debian/Ubuntu 服务器上以 root 执行；安装器会自动配置 Node 服务和 Nginx IP 站点：

```bash
curl -fsSL https://raw.githubusercontent.com/hyp3699/xiu-online/main/deploy/install.sh | env XIU_PUBLIC_IP=54.252.143.152 bash
```

若当前用户不是 root：

```bash
curl -fsSL https://raw.githubusercontent.com/hyp3699/xiu-online/main/deploy/install.sh | sudo env XIU_PUBLIC_IP=54.252.143.152 bash
```

安装器默认也会尝试从 `api.ipify.org` 探测公网 IPv4。若服务器有多个公网地址或探测结果不正确，请显式设置 `XIU_PUBLIC_IP`。安装范围只涉及 `/opt/xiu-online`、`/var/lib/xiu-online`、systemd 服务 `xiu-online-test`、本机 API 端口 `18301` 和 `/xiuxian-test/`，不会覆盖原版 `/opt/xiu`、`/var/lib/xiu`、`xiu-server` 或 `/xiuxian/`。

### 更新

```bash
sudo env XIU_PUBLIC_IP=54.252.143.152 xiu-online-update
```

更新会从 GitHub 拉取 `main`、重启测试服并刷新 Nginx IP 站点配置。检查服务：

```bash
systemctl status xiu-online-test
curl http://127.0.0.1:18301/health
```

### 卸载

```bash
sudo xiu-online-uninstall
```

卸载会删除测试服代码和 `/var/lib/xiu-online` 数据库，**数据删除不可恢复**；不会删除原版游戏或原版存档。

## Nginx 反代地址

IP 入口由 `deploy/nginx-xiuxian-ip.conf` 提供，安装器会把模板中的公网 IP 替换为 `XIU_PUBLIC_IP` 并安装为独立的 Nginx 虚拟主机。网页、API 和 WebSocket 使用同源访问：

| 公网路径 | 服务器目标 |
| --- | --- |
| `/` | 302 跳转到 `/xiuxian-test/` |
| `/xiuxian-test/` | 静态文件 `/opt/xiu-online/web/` |
| `/xiuxian-test/api/` | `http://127.0.0.1:18301/api/` |
| `/xiuxian-test/api/ws` | `http://127.0.0.1:18301/api/ws`，需保留 WebSocket Upgrade |

Node API 只绑定 `127.0.0.1:18301`，不要把 `18301` 端口直接暴露到公网。若改用域名和 HTTPS，请将 `deploy/nginx-xiuxian.conf` include 到对应 HTTPS `server {}` 中，并让页面/API/WebSocket 使用同源 HTTPS/WSS。

**安全提示：**当前 IP 测试入口使用 HTTP 明文传输，账号和密码可被同网络路径上的人读取；只用一次性测试账号和密码，不要填写常用密码或真实数据。`server-url.txt` 当前也指向此 HTTP 测试地址，仅适合临时测试版 APK。正式使用前请配置域名和 HTTPS。

## 设置页与自动保存

玩家操作由服务器处理，服务器在操作后保存状态，并定期写入数据库；关浏览器或更换设备后，重新登录即可继续。设置页不再需要“立即同步”按钮。

## 本地运行与测试

要求 Node.js 20 或更新版本：

```bash
cd server
npm ci
XIU_HOST=127.0.0.1 XIU_PORT=18301 XIU_DATA_DIR=./data npm start
```

健康检查与测试：

```bash
curl http://127.0.0.1:18301/health
cd server && npm test
```
