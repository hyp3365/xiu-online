# 问道长生：服务器版

本仓库将游戏网页和存档服务部署到 Debian / Ubuntu 服务器。网页由 Nginx 提供，Python 标准库实现的 API 服务由 systemd 常驻运行，玩家账号、登录令牌、礼包和存档保存在服务器 SQLite 数据库中；客户端无需本地安装服务器。

## 一键安装

准备一台 Debian / Ubuntu 服务器，并确保已安装 Nginx 且站点的 HTTPS / 域名配置完成。然后执行：

```bash
curl -fsSL https://raw.githubusercontent.com/hyp3699/xiu-online/main/deploy/install.sh | sudo bash
```

安装脚本从本仓库部署代码，注册并启动 `xiu-server` systemd 服务，在本机 `127.0.0.1:18300` 运行 API，并配置 Nginx 反代。游戏网页入口为 `https://你的域名/xiuxian/`。若服务器尚无可用 Nginx `server {}`，请按安装输出提示将 `include snippets/xiuxian.conf;` 加入站点配置后重载 Nginx。

首次注册的账号默认为管理员。请尽早通过管理界面关闭开放注册，并妥善保管管理员账号。

## 服务与数据

- 服务端：`server/server.py`，仅使用 Python 标准库。
- systemd 服务：`xiu-server`，监听地址和端口默认是 `127.0.0.1:18300`。
- 数据库：`/var/lib/xiu/xiu.db`；更新游戏不会删除玩家存档。
- Nginx：网页路径 `/xiuxian/`，API 路径 `/xiuxian/api/`。
- Android 包：构建工作流使用根目录 `server-url.txt` 作为服务地址；如要为另一台服务器构建 APK，请将其中地址改为该服务器的 HTTPS 游戏入口。

## 更新

推送代码到本仓库的 `main` 分支后，在已安装服务器运行：

```bash
sudo xiu-update
```

更新程序会从该服务器工作目录的 GitHub `origin` 拉取新代码、重启存档服务并刷新网页资源；数据库保存在 `/var/lib/xiu/xiu.db`。

## 卸载

卸载会删除所有玩家存档，操作不可恢复。

```bash
sudo xiu-uninstall
```

如果未安装卸载命令：

```bash
curl -fsSL https://raw.githubusercontent.com/hyp3699/xiu-online/main/deploy/uninstall.sh | sudo bash
```
