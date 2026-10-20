#!/bin/bash
# xiu-online 域名管理（快捷命令 x）：从本机已有证书里选域名，自动生成 Nginx HTTPS 站点并填好证书路径。
# 证书目录：/root/cert/<域名>/ 或 /etc/nginx/cert/<域名>/，里面要有 fullchain.pem 和 privkey.pem。
# 生成的配置：/etc/nginx/conf.d/xiu-online-domain-<域名>.conf（游戏路径直接 include 仓库里的 deploy/nginx-xiuxian.conf，更新游戏自动跟着更新）。
# XIU-ONLINE-DOMAIN-TOOL（安装器靠这行识别 /usr/local/bin/x 是不是本工具）
set -uo pipefail
[ "$(id -u)" = 0 ] || exec sudo bash "$0" "$@"

DIR=/opt/xiu-online
DB=/var/lib/xiu-online/xiu-online.sqlite3
CONF_PREFIX=/etc/nginx/conf.d/xiu-online-domain-
GAME_PATH=/xiuxian-test/

re='\033[0m'; red='\033[1;91m'
red()     { echo -e "\033[1;91m$1\033[0m"; }
green()   { echo -e "\033[1;32m$1\033[0m"; }
yellow()  { echo -e "\033[1;93m$1\033[0m"; }
skyblue() { echo -e "\033[1;96m$1\033[0m"; }
reading() { read -r -p "$(echo -e "\033[1;91m$1\033[0m")" "$2" </dev/tty; }

# 检查并选择已有证书
# 调用：check_and_issue_ssl [域名] || return 1   结果在 domain / cert_file / key_file
check_and_issue_ssl() {
    local input_domain="$1"
    domain=""; cert_file=""; key_file=""

    # 无指定域名：显示本地已有证书列表
    if [[ -z "$input_domain" ]]; then
        local cert_domains=() cert_paths=() dir d_name
        shopt -s nullglob
        for dir in /root/cert/* /etc/nginx/cert/*; do
            if [[ -d "$dir" && -f "$dir/fullchain.pem" && -f "$dir/privkey.pem" ]]; then
                d_name=$(basename "$dir")
                if [[ ! " ${cert_domains[*]} " =~ " ${d_name} " ]]; then
                    cert_domains+=("$d_name"); cert_paths+=("$dir")
                fi
            fi
        done
        shopt -u nullglob

        echo
        skyblue "============== 本地已有证书列表 =============="
        local i=2 idx
        if [[ ${#cert_domains[@]} -eq 0 ]]; then
            echo "  (未检测到任何本地证书)"
        else
            for idx in "${!cert_domains[@]}"; do
                local cert_mark="" cert_file_tmp="${cert_paths[$idx]}/fullchain.pem"
                if openssl x509 -in "$cert_file_tmp" -noout -issuer 2>/dev/null | grep -qi "CloudFlare Origin SSL"; then
                    cert_mark=" ${red}【15年证书】${re}"
                fi
                echo -e " ${i}) ${cert_domains[$idx]}${cert_mark}  (路径: ${cert_paths[$idx]})"
                ((i++))
            done
        fi
        skyblue "=============================================="
        echo " 0) 退出"
        echo

        local menu_choice
        reading "请选择已有证书序号 [2-$((i-1))] 或 0 退出: " menu_choice
        if [[ "$menu_choice" == "0" ]]; then red "已取消操作。"; return 1; fi
        if [[ "$menu_choice" =~ ^[0-9]+$ ]] && [[ "$menu_choice" -ge 2 ]] && [[ "$menu_choice" -lt "$i" ]]; then
            local sel_idx=$((menu_choice - 2))
            domain="${cert_domains[$sel_idx]}"
            cert_file="${cert_paths[$sel_idx]}/fullchain.pem"
            key_file="${cert_paths[$sel_idx]}/privkey.pem"
            green "已选择并使用域名 ${domain} 的现有证书。"
            return 0
        fi
        red "无效的选择！"; return 1
    fi

    # 指定域名
    domain=$(echo "$input_domain" | tr -d '[:space:]')
    if [[ -z "$domain" ]]; then red "域名不能为空！"; return 1; fi

    # 1. 该域名自己的证书
    local existing_path=""
    if [[ -f "/root/cert/${domain}/fullchain.pem" && -f "/root/cert/${domain}/privkey.pem" ]]; then
        existing_path="/root/cert/${domain}"
    elif [[ -f "/etc/nginx/cert/${domain}/fullchain.pem" && -f "/etc/nginx/cert/${domain}/privkey.pem" ]]; then
        existing_path="/etc/nginx/cert/${domain}"
    fi
    if [[ -n "$existing_path" ]]; then
        cert_file="${existing_path}/fullchain.pem"; key_file="${existing_path}/privkey.pem"
        skyblue "检测到域名 ${domain} 的证书已存在，直接使用。"
        return 0
    fi

    # 2. 泛域名证书（api.example.com → *.example.com）
    if [[ "$domain" == *.*.* ]]; then
        local parent_domain="${domain#*.}" wildcard_cert="" wildcard_key="" wdir
        for wdir in "/root/cert/*.${parent_domain}" "/etc/nginx/cert/*.${parent_domain}"; do
            if [[ -f "$wdir/fullchain.pem" && -f "$wdir/privkey.pem" ]]; then
                wildcard_cert="$wdir/fullchain.pem"; wildcard_key="$wdir/privkey.pem"; break
            fi
        done
        if [[ -n "$wildcard_cert" ]]; then
            yellow "检测到可用泛域名证书 (*.${parent_domain})。"
            local use_wildcard
            reading "是否直接使用该泛域名证书保护 ${domain}？(y/n): " use_wildcard
            if [[ "$use_wildcard" == "y" || "$use_wildcard" == "Y" ]]; then
                cert_file="$wildcard_cert"; key_file="$wildcard_key"
                green "已选择使用泛域名证书。"; return 0
            fi
        fi

        # 3. 父域名普通证书
        local parent_cert="" parent_key=""
        if [[ -f "/root/cert/${parent_domain}/fullchain.pem" && -f "/root/cert/${parent_domain}/privkey.pem" ]]; then
            parent_cert="/root/cert/${parent_domain}/fullchain.pem"; parent_key="/root/cert/${parent_domain}/privkey.pem"
        elif [[ -f "/etc/nginx/cert/${parent_domain}/fullchain.pem" && -f "/etc/nginx/cert/${parent_domain}/privkey.pem" ]]; then
            parent_cert="/etc/nginx/cert/${parent_domain}/fullchain.pem"; parent_key="/etc/nginx/cert/${parent_domain}/privkey.pem"
        fi
        if [[ -n "$parent_cert" ]]; then
            yellow "当前域名无证书，但检测到父域名 ${parent_domain} 已有普通证书。"
            local use_parent
            reading "是否尝试使用父域名证书？(y/n): " use_parent
            if [[ "$use_parent" == "y" || "$use_parent" == "Y" ]]; then
                cert_file="$parent_cert"; key_file="$parent_key"
                green "已选择使用 ${parent_domain} 的证书。"; return 0
            fi
        fi
    fi

    red "未找到域名 ${domain} 的可用证书。"
    red "证书申请功能已移除，请手动准备证书后重试。"
    return 1
}

conf_of() { echo "${CONF_PREFIX}${1//\*/_wild}.conf"; }

# 把域名加进游戏「游戏线路」列表（管理员 → 服务器信息），安卓客户端就能切换到这个域名
add_line() {
    local url="https://${1}${GAME_PATH}"
    [[ -f "$DB" && -d "$DIR/server/node_modules/better-sqlite3" ]] || { yellow "没找到游戏数据库，跳过加入线路。"; return; }
    cd "$DIR/server" && runuser -u xiu-online -- env XIU_DB="$DB" XIU_URL="$url" XIU_NAME="$1" node --input-type=module -e '
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const Database = require("better-sqlite3");
const db = new Database(process.env.XIU_DB);
db.exec("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
let lines = []; try { lines = JSON.parse(db.prepare("SELECT value FROM settings WHERE key=?").get("lines")?.value || "[]"); } catch {}
if (!Array.isArray(lines)) lines = [];
if (lines.some(l => l.url === process.env.XIU_URL)) { console.log("游戏线路里已经有这个地址。"); process.exit(0); }
lines.push({ name: process.env.XIU_NAME, url: process.env.XIU_URL });
db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run("lines", JSON.stringify(lines));
console.log("已加入游戏线路：" + process.env.XIU_URL);
' 2>&1 | sed 's/^/  /' || true
} 

bind_domain() {
    local input
    echo
    reading "输入要绑定的域名（直接回车 = 从本机已有证书里选）: " input
    check_and_issue_ssl "$input" || return 1

    local conf; conf=$(conf_of "$domain")
    # 别的 Nginx 配置已经用了这个域名：提醒（同一域名两个 server 块，Nginx 只认第一个）
    local other
    local pat="${domain//./\\.}"; pat="${pat//\*/\\*}"
    other=$(grep -rlsE "server_name[^;]*[[:space:]]${pat}([[:space:];]|$)" /etc/nginx/ 2>/dev/null | grep -v "^${conf}$" | grep -v "^${CONF_PREFIX}" || true)
    if [[ -n "$other" ]]; then
        yellow "注意：下面的 Nginx 配置已经在用 ${domain}："
        echo "$other" | sed 's/^/  /'
        yellow "继续的话可能冲突（Nginx 会提示 conflicting server name，只有一个生效）。"
        local go; reading "仍然继续？(y/n): " go
        [[ "$go" == "y" || "$go" == "Y" ]] || { red "已取消。"; return 1; }
    fi

    local backup=""
    [[ -f "$conf" ]] && { backup=$(mktemp); cp "$conf" "$backup"; }
    cat > "$conf" <<EOF
# xiu-online 域名站点（由快捷命令 x 生成，可用 x 删除）
server {
    listen 443 ssl;
    server_name ${domain};
    ssl_certificate     ${cert_file};
    ssl_certificate_key ${key_file};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:xiu_ssl:10m;

    location = / { return 302 ${GAME_PATH}; }
    include ${DIR}/deploy/nginx-xiuxian.conf;
}
server {
    listen 80;
    server_name ${domain};
    location / { return 301 https://\$host\$request_uri; }
}
EOF
    local out
    if out=$(nginx -t 2>&1); then
        systemctl reload nginx
        rm -f "$backup"
        green "绑定成功：https://${domain}${GAME_PATH}"
        echo "  配置文件：${conf}"
        echo "  证书：${cert_file}"
        echo "  私钥：${key_file}"
        if [[ "$domain" != \** ]]; then
            local add; reading "加入游戏「游戏线路」列表（安卓客户端可切换到这个域名）？(y/n): " add
            [[ "$add" == "y" || "$add" == "Y" ]] && add_line "$domain"
        fi
    else
        if [[ -n "$backup" ]]; then mv "$backup" "$conf"; else rm -f "$conf"; fi
        red "Nginx 配置检查没通过，已撤销："
        echo "$out" | sed 's/^/  /'
        return 1
    fi
}

list_domains() {
    local f found=0 n
    echo
    skyblue "============== 已绑定的游戏域名 =============="
    shopt -s nullglob
    for f in ${CONF_PREFIX}*.conf; do
        n=$(grep -m1 -oE "server_name [^;]+" "$f" | cut -d' ' -f2)
        echo "  https://${n}${GAME_PATH}"
        echo "     证书 $(awk '$1=="ssl_certificate"{sub(/;$/,"",$2); print $2; exit}' "$f")"
        found=1
    done
    shopt -u nullglob
    [[ $found == 1 ]] || echo "  (还没有绑定域名)"
    skyblue "=============================================="
}

remove_domain() {
    local files=() f i=1 n c
    shopt -s nullglob; files=(${CONF_PREFIX}*.conf); shopt -u nullglob
    [[ ${#files[@]} -gt 0 ]] || { yellow "还没有绑定域名。"; return; }
    echo
    for f in "${files[@]}"; do
        n=$(grep -m1 -oE "server_name [^;]+" "$f" | cut -d' ' -f2)
        echo " ${i}) ${n}"; ((i++))
    done
    echo " 0) 返回"
    reading "选择要删除的域名: " c
    [[ "$c" =~ ^[0-9]+$ && "$c" -ge 1 && "$c" -lt "$i" ]] || return
    rm -f "${files[$((c-1))]}"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx
    green "已删除（证书文件没动；游戏线路列表请在游戏「服务器信息」里自己删）。"
}

while true; do
    echo
    skyblue "========== xiu-online 域名管理 =========="
    echo " 1) 绑定域名（选择已有证书，自动填写证书路径）"
    echo " 2) 查看已绑定的域名"
    echo " 3) 删除已绑定的域名"
    echo " 0) 退出"
    skyblue "========================================="
    reading "请选择: " ch
    case "$ch" in
        1) bind_domain ;;
        2) list_domains ;;
        3) remove_domain ;;
        0|"") exit 0 ;;
        *) red "无效的选择！" ;;
    esac
done
