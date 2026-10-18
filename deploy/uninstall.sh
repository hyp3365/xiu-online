#!/bin/bash
# =====================================================================
# 问道长生 · 一键卸载（需 root 或 sudo）
# 用法：sudo xiu-uninstall
#   或：curl -fsSL https://raw.githubusercontent.com/hyp3699/xiu-online/main/deploy/uninstall.sh | sudo bash
# 会删除：存档服务、网页更新服务、全部玩家存档（/var/lib/xiu）、代码（/opt/xiu）、
#        xiu-update / xiu-uninstall 命令、sudo 规则、nginx 配置、xiu 系统用户、全部日志（server.log / update.log）
# 跳过确认：XIU_YES=1 sudo -E xiu-uninstall
# =====================================================================
[ "$(id -u)" = 0 ] || exec sudo "$0" "$@"

if [ "${XIU_YES:-}" != "1" ]; then
  echo "将删除问道长生的全部数据（包括所有玩家存档）、日志和文件，无法恢复。"
  printf "确认卸载请输入 yes："
  read -r ans </dev/tty || ans=""
  [ "$ans" = "yes" ] || { echo "已取消。"; exit 1; }
fi

echo ">>> 停止服务..."
for u in xiu-server xiu-web-update; do
  systemctl stop "$u" 2>/dev/null
  systemctl disable "$u" 2>/dev/null
  rm -f "/etc/systemd/system/$u.service"
done
systemctl daemon-reload
systemctl reset-failed xiu-server xiu-web-update 2>/dev/null

echo ">>> 删除日志..."
# 存档服务日志写在 /var/lib/xiu/server.log、网页更新日志 /var/lib/xiu/update.log（下面随数据目录一起删）

echo ">>> 删除 nginx 配置..."
rm -f /etc/nginx/conf.d/central_vps_users/*/xiuxian.conf /etc/nginx/conf.d/central_vps_users/*/xiuxian.conf.bak \
      /etc/nginx/snippets/xiuxian.conf /etc/nginx/snippets/xiuxian.conf.bak
if command -v nginx >/dev/null; then
  if nginx -t >/dev/null 2>&1; then systemctl reload nginx
  else echo "注意：nginx 的 server{} 里还留着 include snippets/xiuxian.conf; 这一行，请手动删掉后运行 systemctl reload nginx"; fi
fi

echo ">>> 删除文件和数据..."
rm -rf /opt/xiu /var/lib/xiu /tmp/xiu-sudo
rm -f /etc/sudoers.d/xiu-update /usr/local/bin/xiu-update /usr/local/bin/xiu-uninstall
id xiu >/dev/null 2>&1 && userdel xiu 2>/dev/null

echo ">>> 卸载完成。"
