package tv.vix.app;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Heartbeat para Conexiones en vivo (admin) desde la app TV nativa. */
public final class TvActivityReporter {
    private static final long INTERVAL_MS = 8000L;

    private final Activity activity;
    private final ExecutorService executor;
    private final Handler handler;
    private final Runnable tick;
    private final String sessionKey;
    private volatile boolean running;

    private String status = "browsing";
    private String page = "home";
    private String title = "Inicio";
    private String contentType = "";
    private int contentId = 0;
    private long progressSec = 0;
    private long durationSec = 0;

    public TvActivityReporter(Activity activity, boolean playerSession) {
        this.activity = activity;
        this.executor = Executors.newSingleThreadExecutor();
        this.handler = new Handler(Looper.getMainLooper());
        this.sessionKey = playerSession
            ? ActivitySession.playerKey(activity)
            : ActivitySession.shellKey(activity);
        this.tick = this::sendAndSchedule;
    }

    public void update(String status, String page, String title, String contentType, int contentId) {
        update(status, page, title, contentType, contentId, 0, 0);
    }

    public void update(String status, String page, String title, String contentType,
                       int contentId, long progressSec, long durationSec) {
        this.status = status != null ? status : "browsing";
        this.page = page != null ? page : "";
        this.title = title != null ? title : "";
        this.contentType = contentType != null ? contentType : "";
        this.contentId = contentId;
        this.progressSec = progressSec;
        this.durationSec = durationSec;
    }

    public void start() {
        if (running) return;
        running = true;
        handler.removeCallbacks(tick);
        sendAndSchedule();
    }

    public void stop() {
        running = false;
        handler.removeCallbacks(tick);
        executor.execute(() -> new VixApi(activity).sendActivityOffline(sessionKey));
    }

    public void destroy() {
        stop();
        executor.shutdownNow();
    }

    private void sendAndSchedule() {
        if (!running) return;
        handler.postDelayed(tick, INTERVAL_MS);
        final String fStatus = status;
        final String fPage = page;
        final String fTitle = title;
        final String fType = contentType;
        final int fCid = contentId;
        final long fProg = progressSec;
        final long fDur = durationSec;
        executor.execute(() -> new VixApi(activity).sendActivityHeartbeat(
            fStatus, fPage, fTitle, fType, fCid, fProg, fDur, sessionKey
        ));
    }
}
