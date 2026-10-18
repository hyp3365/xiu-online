#!/bin/bash
# =====================================================================
# 问道长生 · 一键安装（Debian/Ubuntu，需 root 或 sudo）
# 用法：curl -fsSL https://raw.githubusercontent.com/hyp3699/xiu-online/main/deploy/install.sh | sudo bash
# 做了什么：
#   1. 安装 git、python3
#   2. 把仓库克隆到 /opt/xiu
#   3. 安装存档服务 xiu-server（systemd，监听 127.0.0.1:18300）
#   4. 安装快捷更新命令 xiu-update
#   5. 给 nginx 加 /xiuxian/ 网页和 /xiuxian/api/ 接口
# =====================================================================
set -e
REPO="${XIU_REPO:-https://github.com/hyp3699/xiu-online.git}"
DIR=/opt/xiu

apt-get update -qq && apt-get install -y -qq git python3 >/dev/null

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  rm -rf "$DIR" && git clone --depth 1 "$REPO" "$DIR"
fi

# 存档目录
mkdir -p /var/lib/xiu
id xiu >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin xiu
chown -R xiu:xiu /var/lib/xiu

# systemd 服务
cp "$DIR/deploy/xiu-server.service" /etc/systemd/system/xiu-server.service
systemctl daemon-reload
systemctl enable --now xiu-server
systemctl restart xiu-server

# 更新命令
install -m 755 "$DIR/deploy/xiu-update" /usr/local/bin/xiu-update
install -m 755 "$DIR/deploy/uninstall.sh" /usr/local/bin/xiu-uninstall

# nginx：优先放进现有的 IP 站点（HTTPS），没有就放到默认站点
NGX_DIR=$(ls -d /etc/nginx/conf.d/central_vps_users/*/ 2>/dev/null | head -1)
if [ -n "$NGX_DIR" ]; then
  cp "$DIR/deploy/nginx-xiuxian.conf" "${NGX_DIR}xiuxian.conf"
else
  mkdir -p /etc/nginx/snippets
  cp "$DIR/deploy/nginx-xiuxian.conf" /etc/nginx/snippets/xiuxian.conf
  echo ">>> 请在 nginx 的 server{} 里加入一行：include snippets/xiuxian.conf;"
fi
nginx -t && { systemctl is-active --quiet nginx && systemctl reload nginx || systemctl start nginx; }

echo "安装完成。以后更新只需运行：sudo xiu-update；卸载：sudo xiu-uninstall"
