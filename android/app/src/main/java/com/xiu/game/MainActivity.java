package com.xiu.game;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

// 打开游戏网页。服务器地址来自仓库根目录 server-url.txt（打包时复制到 assets/server.txt）
// 图片：打包时把 web/img 放进安装包（assets/img）。启动时读服务器的图片清单 img_ver.txt（sudo xiu-update 生成），
//   逐张比对：和包里一样的直接用包里的，服务器换过的那几张才去服务器下载（不会因为换了一张图就全部重新下载）
public class MainActivity extends Activity {
    private static final int BG = Color.parseColor("#14110f");
    private WebView web;
    private String imgTree = "";
    private final HashMap<String, String> imgHash = new HashMap<>();
    private volatile HashMap<String, String> srvHash = null;          // 服务器图片清单
    private final CountDownLatch srvReady = new CountDownLatch(1);

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);   // 全屏：不显示手机顶部状态栏
        w.setStatusBarColor(BG);
        w.setNavigationBarColor(BG);
        w.getDecorView().setBackgroundColor(BG);
        loadImgVer();
        loadSrvHash();
        setContentView(makeWeb());
        if (b != null) web.restoreState(b);
        else web.loadUrl(serverUrl());
    }

    // 建 WebView（网页进程被系统回收时会重新建一个）
    private WebView makeWeb() {
        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setTextZoom(100);   // 不跟随手机系统字体大小，和浏览器里一样
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.setWebViewClient(new WebViewClient() {
            // 安装版标记：网页 html 加 class="apk"，样式里底部导航往上抬一点，避开手机底部手势条
            @Override
            public void onPageFinished(WebView v, String url) {
                v.evaluateJavascript("document.documentElement.classList.add('apk')", null);
            }
            // 切到后台久了，系统可能回收网页进程：不让整个 App 崩溃 / 一直黑屏，换一个新的 WebView 重新打开游戏
            @Override
            @android.annotation.TargetApi(26)
            public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                if (v == web) {
                    android.view.ViewGroup p = (android.view.ViewGroup) v.getParent();
                    if (p != null) p.removeView(v);
                    v.destroy();
                    setContentView(makeWeb());
                    web.loadUrl(serverUrl());
                } else v.destroy();
                return true;
            }
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                WebResourceResponse r = localImg(req.getUrl());
                return r != null ? r : super.shouldInterceptRequest(v, req);
            }
        });
        web.setWebChromeClient(new WebChromeClient());   // 让网页的确认框 / 提示框（confirm、alert）能弹出来
        return web;
    }

    // 切后台 / 切回来：通知 WebView（切回来时马上恢复绘制，减少黑屏）；不暂停 JS 定时器，切后台时网页还要上传存档
    @Override
    protected void onPause() { super.onPause(); if (web != null) web.onPause(); }
    @Override
    protected void onResume() { super.onResume(); if (web != null) { web.onResume(); web.resumeTimers(); web.invalidate(); } }

    private void loadImgVer() {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(getAssets().open("img_ver.txt"), "UTF-8"))) {
            imgTree = r.readLine();
            if (imgTree == null) imgTree = "";
            imgTree = imgTree.trim();
            String line;
            while ((line = r.readLine()) != null) {
                int i = line.lastIndexOf(' ');
                if (i > 0) imgHash.put(line.substring(0, i), line.substring(i + 1).trim());
            }
        } catch (Exception e) { }
    }

    private void loadSrvHash() {
        new Thread(() -> {
            try {
                String base = serverUrl(); if (!base.endsWith("/")) base += "/";
                HttpURLConnection c = (HttpURLConnection) new URL(base + "img_ver.txt?t=" + System.currentTimeMillis()).openConnection();
                c.setConnectTimeout(4000); c.setReadTimeout(4000);
                if (c.getResponseCode() == 200) {
                    HashMap<String, String> m = new HashMap<>();
                    try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
                        String line;
                        while ((line = r.readLine()) != null) {
                            int i = line.lastIndexOf(' ');
                            if (i > 0) m.put(line.substring(0, i), line.substring(i + 1).trim());
                        }
                    }
                    if (!m.isEmpty()) srvHash = m;
                }
                c.disconnect();
            } catch (Exception e) { }
            srvReady.countDown();
        }).start();
    }

    private WebResourceResponse localImg(Uri u) {
        try {
            String path = u.getPath();
            if (path == null) return null;
            int i = path.indexOf("/img/");
            if (i < 0) return null;
            String rel = path.substring(i + 5);
            String h = imgHash.get(rel);
            if (h == null) return null;                       // 包里没有这张图
            try { srvReady.await(5, TimeUnit.SECONDS); } catch (InterruptedException e) { }
            HashMap<String, String> sh = srvHash;
            if (sh != null) {
                String s2 = sh.get(rel);
                if (s2 != null && !s2.equals(h)) return null;          // 服务器换了这张图 → 去服务器下载
            } else {
                String v = u.getQueryParameter("v");                    // 读不到清单：按旧办法比对版本号
                if (v != null && !v.equals(imgTree) && !v.equals(h) && v.length() == 8) return null;
            }
            String mime = rel.endsWith(".webp") ? "image/webp" : rel.endsWith(".png") ? "image/png"
                    : rel.endsWith(".svg") ? "image/svg+xml" : rel.endsWith(".gif") ? "image/gif" : "image/jpeg";
            return new WebResourceResponse(mime, null, getAssets().open("img/" + rel));
        } catch (Exception e) {
            return null;
        }
    }

    private String serverUrl() {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(getAssets().open("server.txt"), "UTF-8"))) {
            String line;
            while ((line = r.readLine()) != null) {
                line = line.trim();
                if (!line.isEmpty() && !line.startsWith("#")) return line;
            }
        } catch (Exception e) { }
        return "about:blank";
    }

    @Override
    protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); web.saveState(b); }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
