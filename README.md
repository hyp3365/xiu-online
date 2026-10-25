
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

SSH 里输入 x

**APK 服务器地址是仓库根目录 `server-url.txt`。** 打包 APK 前，将它改成目标服务器地址，例如：

```text
http://你的服务器公网IP/xiuxian-test/
```

