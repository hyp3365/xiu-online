
- 测试服页面：`http://<服务器公网IP>/xiuxian-test/`

### 安装

Debian/Ubuntu 服务器上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/hyp3699/xiu-online/main/deploy/install.sh | sudo bash
```

安装器会自动配置 Node 服务和 Nginx IP 站点。安装范围只涉及 `/opt/xiu-online`、`/var/lib/xiu-online`、systemd 服务 `xiu-online-test`、本机 API 端口 `18301` 和 `/xiuxian-test/`，不会覆盖原版 `/opt/xiu`、`/var/lib/xiu`、`xiu-server` 或 `/xiuxian/`。

### 更新

```bash
sudo xiu-online-update
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

## 绑定域名（HTTPS）

SSH 里输入 `x`：直接列出 `/root/cert/<域名>/` 和 `/etc/nginx/cert/<域名>/`（需有 `fullchain.pem`、`privkey.pem`）里的域名，选一个就把域名和证书写进 `/etc/nginx/conf.d/xiu-online-domain.conf` 并重载 Nginx，同时加入游戏「游戏线路」。再运行 `x` 选别的就是换域名，选 1 取消域名。`x 子域名` 可匹配泛域名或父域名证书。`/usr/local/bin/x` 被别的程序占用时用 `xiu-online-domain`。

## 打包 APK 时设置服务器地址

**唯一需要手动维护的 APK 服务器地址是仓库根目录 `server-url.txt`。** 打包 APK 前，将它改成目标服务器地址，例如：

```text
http://你的服务器公网IP/xiuxian-test/
```

安装器和更新器会独立探测它们所在服务器的公网 IPv4，所以不用修改安装命令或 Nginx 配置。构建 APK 的工作流会读取 `server-url.txt` 作为 APK 默认服务地址。

## Cloudflare Tunnel（Nginx 源站无需证书）

Cloudflare Tunnel 在 Cloudflare 边缘提供浏览器侧 HTTPS，Tunnel 到本机 Nginx 使用 HTTP，因此 Nginx 不需要证书。Tunnel 与 Nginx 需运行在同一台服务器上；在 Cloudflare Zero Trust 的 Public Hostname 中设置：

- Hostname：你的域名，例如 `game.example.com`
- Service type：`HTTP`
- URL：`127.0.0.1:18302`（即 `http://127.0.0.1:18302`）

随后访问 `https://你的域名/xiuxian-test/`，访问域名根路径也会跳转到游戏。`18302` 是仅监听本机的 Nginx Tunnel origin；Nginx 再把网页/API/WebSocket 正确分流。`18301` 是 Node API 端口，不能把 Tunnel 直接指向它，否则访问未登录的 API 会得到“登录已过期”JSON，而不是网页。两个本机端口都不需要在安全组中向公网开放。

如果 Tunnel 运行在 Docker 容器里，容器内的 `127.0.0.1` 指向容器自身，而不是宿主机；应让 Tunnel 在宿主机运行，或配置容器到宿主机的安全网络访问。

## Nginx 反代地址

安装器会自动探测当前机器公网 IPv4，并用其生成 `deploy/nginx-xiuxian-ip.conf` 对应的 Nginx 虚拟主机。网页、API 和 WebSocket 使用同源访问：

| 公网路径 | 服务器目标 |
| --- | --- |
| `/` | 302 跳转到 `/xiuxian-test/` |
| `/xiuxian-test/` | 静态文件 `/opt/xiu-online/web/` |
| `/xiuxian-test/api/` | `http://127.0.0.1:18301/api/` |
| `/xiuxian-test/api/ws` | `http://127.0.0.1:18301/api/ws`，需保留 WebSocket Upgrade |

Node API 只绑定 `127.0.0.1:18301`，不要把 `18301` 端口直接暴露到公网。若改用域名和 HTTPS，请将 `deploy/nginx-xiuxian.conf` include 到对应 HTTPS `server {}` 中，并让页面/API/WebSocket 使用同源 HTTPS/WSS。


