#!/bin/bash
# 配置「最新备份上传到 GitHub」：填私有仓库名和令牌，之后每小时自动上传一次
set -euo pipefail
[ "$(id -u)" = 0 ] || exec sudo "$0" "$@"
echo "需要一个 GitHub【私有】仓库（不要用公开仓库：备份里有所有账号和存档）"
read -r -p "仓库（例如 hyp3699/xiu-online-backup）: " REPO
echo "令牌：GitHub → Settings → Developer settings → Fine-grained tokens → 只选这个仓库，Contents 选 Read and write"
read -r -s -p "粘贴令牌（不会显示）: " TOKEN; echo
[ -n "$REPO" ] && [ -n "$TOKEN" ] || { echo "仓库和令牌都不能为空" >&2; exit 1; }
mkdir -p /etc/xiu-online; chmod 700 /etc/xiu-online
umask 077
printf 'REPO=%q\nTOKEN=%q\n' "$REPO" "$TOKEN" > /etc/xiu-online/backup-github.env
chmod 600 /etc/xiu-online/backup-github.env
systemctl daemon-reload
systemctl enable --now xiu-online-backup-github.timer
echo "先上传一次试试…"
/usr/local/bin/xiu-online-backup-github && echo "配置完成：以后每小时自动上传最新备份。"
