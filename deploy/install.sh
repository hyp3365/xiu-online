#!/bin/bash
# xiu-online 独立测试服安装器（Debian/Ubuntu，需 root 或 sudo）。
# 只使用 /opt/xiu-online、/var/lib/xiu-online、xiu-online-test、18301 和 /xiuxian-test/；
# 不停止、不覆盖原版 xiu-server、/opt/xiu、/var/lib/xiu 或 /xiuxian/。
set -euo pipefail
[ "$(id -u)" = 0 ] || exec sudo -E bash "$0" "$@"
REPO="${XIU_REPO:-https://github.com/hyp3699/xiu-online.git}"
DIR=/opt/xiu-online
DATA_DIR=/var/lib/xiu-online
SERVICE=xiu-online-test
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git nginx >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs >/dev/null
fi
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth 1 origin main
  git -C "$DIR" reset --hard FETCH_HEAD
else
  [ ! -e "$DIR" ] || { echo "$DIR 已存在但不是 Git 仓库，停止以免覆盖。" >&2; exit 1; }
  git clone --depth 1 --branch main "$REPO" "$DIR"
fi
id xiu-online >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin xiu-online
install -d -o xiu-online -g xiu-online -m 0750 "$DATA_DIR"
(cd "$DIR/server" && npm ci --omit=dev --no-audit --no-fund)
install -m 0644 "$DIR/deploy/xiu-server.service" "/etc/systemd/system/${SERVICE}.service"
systemctl daemon-reload
systemctl enable --now "$SERVICE"
install -m 0755 "$DIR/deploy/xiu-update" /usr/local/bin/xiu-online-update
install -m 0755 "$DIR/deploy/uninstall.sh" /usr/local/bin/xiu-online-uninstall
NGX_DIR=$(find /etc/nginx/conf.d/central_vps_users -mindepth 1 -maxdepth 1 -type d -print -quit 2>/dev/null || true)
if [ -n "$NGX_DIR" ]; then
  install -m 0644 "$DIR/deploy/nginx-xiuxian.conf" "$NGX_DIR/xiu-online-test.conf"
else
  install -d /etc/nginx/snippets
  install -m 0644 "$DIR/deploy/nginx-xiuxian.conf" /etc/nginx/snippets/xiu-online-test.conf
  echo ">>> 请在 HTTPS 站点的 server{} 中加入：include snippets/xiu-online-test.conf;"
fi
# 独立的公网 IP HTTP server block；HTTP 80 已可达，IP 根路径会跳到 /xiuxian-test/。
install -m 0644 "$DIR/deploy/nginx-xiuxian-ip.conf" /etc/nginx/conf.d/xiu-online-ip-test.conf
nginx -t
systemctl is-active --quiet nginx && systemctl reload nginx || systemctl start nginx
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:18301/health >/dev/null && break || sleep 1; done
curl -fsS http://127.0.0.1:18301/health >/dev/null
printf '\n安装完成：\n  IP 测试入口（HTTP）：http://56.69.168.157/\n  HTTPS 入口（配置好站点后）：https://你的域名/xiuxian-test/\n  Node API：127.0.0.1:18301\n  服务：systemctl status %s\n  手动更新：sudo xiu-online-update\n  卸载：sudo xiu-online-uninstall\n' "$SERVICE"
echo '注意：IP 测试入口使用明文 HTTP，仅限临时测试；请用一次性测试账号和密码，不要输入常用密码。'
