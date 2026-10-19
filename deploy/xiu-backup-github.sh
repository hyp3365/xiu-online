#!/bin/bash
# 把最新一份数据库备份（服务器每小时自动生成）压缩后上传到 GitHub 私有仓库。
# 仓库里只保留最新这一份（每次强制覆盖，不堆历史，仓库不会越来越大）。
# 配置：/etc/xiu-online/backup-github.env（用 sudo xiu-online-backup-setup 生成）
set -euo pipefail
ENV=/etc/xiu-online/backup-github.env
BACKUP_DIR=/var/lib/xiu-online/backup
[ -f "$ENV" ] || { echo "还没配置：先运行 sudo xiu-online-backup-setup" >&2; exit 1; }
# shellcheck disable=SC1090
. "$ENV"
: "${REPO:?}" "${TOKEN:?}"
LATEST=$(ls -1 "$BACKUP_DIR"/xiu-*.sqlite3 2>/dev/null | sort | tail -n 1 || true)
[ -n "$LATEST" ] || { echo "还没有备份文件（服务器启动 1 分钟后生成第一份）" >&2; exit 1; }
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
NAME=$(basename "$LATEST")
gzip -9 -c "$LATEST" > "$WORK/xiu-online.sqlite3.gz"
SIZE=$(du -k "$WORK/xiu-online.sqlite3.gz" | cut -f1)
printf '# 问道长生 存档备份\n\n- 备份：%s\n- 压缩后：%s KB\n\n恢复：gunzip xiu-online.sqlite3.gz，停服后替换 /var/lib/xiu-online/xiu-online.sqlite3（并删除同目录的 -wal、-shm 文件），再启动。\n' "$NAME" "$SIZE" > "$WORK/README.md"
cd "$WORK"
git init -q -b main
git -c user.name=xiu-backup -c user.email=backup@localhost add -A
git -c user.name=xiu-backup -c user.email=backup@localhost commit -qm "备份 $NAME"
git push -q --force "https://x-access-token:${TOKEN}@github.com/${REPO}.git" main 2>&1 | sed "s/${TOKEN}/***/g"
echo "已上传 $NAME（${SIZE} KB）到 github.com/${REPO}"
