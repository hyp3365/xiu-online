
### 安装

Debian/Ubuntu 服务器上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/hyp3699/xiu-online/main/deploy/install.sh | sudo bash
```

### 更新

```bash
sudo xiu-online-update
```


```bash
systemctl status xiu-online-test
curl http://127.0.0.1:18301/health
```

### 卸载

```bash
sudo xiu-online-uninstall
```


## 绑定域名（HTTPS）

SSH 里输入 `x`：直接列出 `/root/cert/<域名>/` 和 `/etc/nginx/cert/<域名>/`（需有 `fullchain.pem`、`privkey.pem`）里的域名，选一个就把域名和证书写进 `/etc/nginx/conf.d/xiu-online-domain.conf` 并重载 Nginx，同时加入游戏「游戏线路」。再运行 `x` 选别的就是换域名，选 1 取消域名。`x 子域名` 可匹配泛域名或父域名证书。`/usr/local/bin/x` 被别的程序占用时用 `xiu-online-domain`。

## 打包 APK 时设置服务器地址

**唯一需要手动维护的 APK 服务器地址是仓库根目录 `server-url.txt`。** 打包 APK 前，将它改成目标服务器地址，例如：

```text
http://你的服务器公网IP/xiuxian-test/
```

