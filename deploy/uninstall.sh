#!/bin/bash
# 只卸载 xiu-online 测试服；不会删除原版 /opt/xiu、/var/lib/xiu 或 xiu-server。
set -euo pipefail
[ "$(id -u)" = 0 ] || exec sudo -E bash "$0" "$@"
if [ "${XIU_YES:-}" != "1" ]; then
  echo "将删除 xiu-online 测试服代码与数据库 /var/lib/xiu-online；原版游戏及存档不会触碰。"
  printf "确认卸载请输入 yes："
  read -r answer </dev/tty || answer=""
  [ "$answer" = "yes" ] || { echo "已取消。"; exit 1; }
fi
SERVICE=xiu-online-test
systemctl stop "$SERVICE" 2>/dev/null || true
systemctl disable "$SERVICE" 2>/dev/null || true
rm -f "/etc/systemd/system/${SERVICE}.service"
systemctl daemon-reload
systemctl reset-failed "$SERVICE" 2>/dev/null || true
rm -f /etc/nginx/conf.d/central_vps_users/*/xiu-online-test.conf /etc/nginx/conf.d/xiu-online-test.conf /etc/nginx/snippets/xiu-online-test.conf
if command -v nginx >/dev/null && nginx -t >/dev/null 2>&1; then systemctl reload nginx || true; fi
rm -rf /opt/xiu-online /var/lib/xiu-online
rm -f /usr/local/bin/xiu-online-update /usr/local/bin/xiu-online-uninstall
id xiu-online >/dev/null 2>&1 && userdel xiu-online 2>/dev/null || true
echo "xiu-online 测试服已卸载。原版游戏与存档未动。"
