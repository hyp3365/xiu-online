package com.xiu.game;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

// 切到后台时的前台服务：通知栏常驻一条「问道长生 后台运行中」，系统就不会冻结 App，
//   网页和服务器的连接保持不断，切回来不用重新连接、重新加载
// 最多保持 KEEP_MS（默认 2 小时），之后自动停止，避免一直耗电
public class KeepAliveService extends Service {
    private static final String CH = "keep";
    private static final long KEEP_MS = 2L * 60 * 60 * 1000;
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;
    private final android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable end = this::stopSelf;

    static void start(Context c) {
        try {
            on = true;
            Intent i = new Intent(c, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception e) { }
    }
    static volatile boolean on = false;
    // 不能直接 stopService：服务刚启动还没来得及 startForeground 就被停，安卓 12+ 会闪退；改为发「停止」让它自己先进前台再退出
    static void stop(Context c) {
        if (!on) return;
        try { c.startService(new Intent(c, KeepAliveService.class).setAction("stop")); } catch (Exception e) { }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm.getNotificationChannel(CH) == null) {
                NotificationChannel ch = new NotificationChannel(CH, "后台运行", NotificationManager.IMPORTANCE_LOW);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
            b = new Notification.Builder(this, CH);
        } else b = new Notification.Builder(this);
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Notification n = b.setContentTitle("问道长生").setContentText("后台运行中，点此回到游戏")
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim).setContentIntent(pi).setOngoing(true).build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(1, n);
        } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
        on = true;
        if (intent != null && "stop".equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        try {
            if (wake == null) {
                wake = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "xiu:keep");
                wake.setReferenceCounted(false);
            }
            wake.acquire(KEEP_MS);
            if (wifi == null) {
                wifi = ((WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE)).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "xiu:keep");
                wifi.setReferenceCounted(false);
            }
            wifi.acquire();
        } catch (Exception e) { }
        h.removeCallbacks(end);
        h.postDelayed(end, KEEP_MS);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        on = false;
        h.removeCallbacks(end);
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Exception e) { }
        try { if (wifi != null && wifi.isHeld()) wifi.release(); } catch (Exception e) { }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent i) { return null; }
}
