package tv.vix.app;

import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.widget.ImageButton;
import android.widget.ImageView;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.ui.PlayerView;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.util.Iterator;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** Resolución y reproducción de tráilers HLS/MP4 con caché en memoria y disco. */
public final class MobileTrailerHelper {
    private static final long DISK_TTL_MS = 6L * 60L * 60L * 1000L; // 6 h
    private static final ConcurrentHashMap<String, VixApi.TrailerInfo> MEM_CACHE = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, Object> IN_FLIGHT = new ConcurrentHashMap<>();
    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();

    public interface PlayCallback {
        void onReady(ExoPlayer player);
        void onError();
    }

    private MobileTrailerHelper() {}

    public static void prefetch(Context ctx, @Nullable String trailer) {
        resolveInfo(ctx, trailer, info -> { /* warm */ });
    }

    public static void resolveUrl(Context ctx, @Nullable String trailer, Consumer<String> callback) {
        resolveInfo(ctx, trailer, info -> callback.accept(info != null ? info.playUrl : null));
    }

    public static void resolveInfo(Context ctx, @Nullable String trailer, Consumer<VixApi.TrailerInfo> callback) {
        if (callback == null) return;
        String key = TvTrailerHelper.extractYoutubeKey(trailer != null ? trailer : "");
        if (key.isEmpty()) {
            callback.accept(null);
            return;
        }
        VixApi.TrailerInfo cached = MEM_CACHE.get(key);
        if (cached == null) cached = readDiskEntry(ctx, key);
        if (cached != null) {
            MEM_CACHE.put(key, cached);
            deliver(ctx, callback, cached);
            return;
        }
        Object lock = IN_FLIGHT.computeIfAbsent(key, k -> new Object());
        synchronized (lock) {
            cached = MEM_CACHE.get(key);
            if (cached == null) cached = readDiskEntry(ctx, key);
            if (cached != null) {
                MEM_CACHE.put(key, cached);
                deliver(ctx, callback, cached);
                return;
            }
            Context app = ctx.getApplicationContext();
            EXECUTOR.execute(() -> {
                VixApi.TrailerInfo info = null;
                try {
                    info = new VixApi(app).trailerInfo(trailer);
                    if (info != null && info.playUrl != null && !info.playUrl.isEmpty()) {
                        MEM_CACHE.put(key, info);
                        writeDiskEntry(app, info);
                    }
                } catch (Exception ignored) {
                    /* sin tráiler */
                } finally {
                    IN_FLIGHT.remove(key);
                }
                final VixApi.TrailerInfo result = info;
                deliver(ctx, callback, result);
            });
        }
    }

    private static void deliver(Context ctx, Consumer<VixApi.TrailerInfo> callback, VixApi.TrailerInfo info) {
        if (ctx instanceof AppCompatActivity) {
            ((AppCompatActivity) ctx).runOnUiThread(() -> callback.accept(info));
        } else {
            callback.accept(info);
        }
    }

    public static ExoPlayer playInView(
        AppCompatActivity activity,
        PlayerView playerView,
        @Nullable ImageButton muteButton,
        @Nullable ImageView backdropUntilReady,
        @Nullable ExoPlayer existing,
        VixApi.TrailerInfo info,
        boolean muted
    ) {
        if (activity.isFinishing() || info == null || info.playUrl == null
            || info.playUrl.isEmpty() || playerView == null) {
            return existing;
        }
        return playInView(activity, playerView, muteButton, backdropUntilReady, existing,
            info.playUrl, info.isHls(), muted, null);
    }

    public static ExoPlayer playInView(
        AppCompatActivity activity,
        PlayerView playerView,
        @Nullable ImageButton muteButton,
        @Nullable ImageView backdropUntilReady,
        @Nullable ExoPlayer existing,
        String playUrl,
        boolean muted
    ) {
        return playInView(activity, playerView, muteButton, backdropUntilReady, existing,
            playUrl, isHlsUrl(playUrl), muted, null);
    }

    public static ExoPlayer playInView(
        AppCompatActivity activity,
        PlayerView playerView,
        @Nullable ImageButton muteButton,
        @Nullable ImageView backdropUntilReady,
        @Nullable ExoPlayer existing,
        String playUrl,
        boolean hls,
        boolean muted,
        @Nullable PlayCallback callback
    ) {
        if (activity.isFinishing() || playUrl == null || playUrl.isEmpty() || playerView == null) {
            return existing;
        }
        String token = NativeAuth.getToken(activity);
        DataSource.Factory dataFactory = MobileMediaCache.dataSourceFactory(activity, token);
        MediaSource source;
        if (hls) {
            source = new HlsMediaSource.Factory(dataFactory)
                .createMediaSource(MediaItem.fromUri(Uri.parse(playUrl)));
        } else {
            source = new ProgressiveMediaSource.Factory(dataFactory)
                .createMediaSource(MediaItem.fromUri(Uri.parse(playUrl)));
        }
        ExoPlayer player = existing;
        if (player == null) {
            player = new ExoPlayer.Builder(activity).build();
        } else {
            player.stop();
            player.clearMediaItems();
        }
        player.setRepeatMode(Player.REPEAT_MODE_ONE);
        player.setVolume(muted ? 0f : 1f);
        playerView.setUseController(false);
        playerView.setShutterBackgroundColor(Color.TRANSPARENT);
        playerView.setKeepContentOnPlayerReset(true);
        playerView.setPlayer(player);
        if (backdropUntilReady != null) {
            backdropUntilReady.setVisibility(View.VISIBLE);
            backdropUntilReady.setAlpha(1f);
        }
        playerView.setVisibility(View.VISIBLE);
        playerView.setAlpha(0f);
        final ExoPlayer boundPlayer = player;
        player.addListener(new Player.Listener() {
            @Override
            public void onRenderedFirstFrame() {
                playerView.setAlpha(1f);
                if (backdropUntilReady != null) backdropUntilReady.setVisibility(View.GONE);
                if (callback != null) callback.onReady(boundPlayer);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY && boundPlayer.isPlaying() && playerView.getAlpha() < 1f) {
                    playerView.setAlpha(1f);
                    if (backdropUntilReady != null) backdropUntilReady.setVisibility(View.GONE);
                    if (callback != null) callback.onReady(boundPlayer);
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                playerView.setAlpha(0f);
                playerView.setVisibility(View.GONE);
                if (backdropUntilReady != null) {
                    backdropUntilReady.setVisibility(View.VISIBLE);
                    backdropUntilReady.setAlpha(1f);
                }
                if (callback != null) callback.onError();
            }
        });
        player.setMediaSource(source);
        player.prepare();
        player.setPlayWhenReady(true);
        if (muteButton != null) {
            muteButton.setVisibility(View.VISIBLE);
            muteButton.setImageResource(muted ? R.drawable.ic_mobile_volume_off : R.drawable.ic_mobile_volume_on);
        }
        return player;
    }

    public static void warmStreamCache(Context ctx, VixApi.TrailerInfo info) {
        if (info == null || info.playUrl == null || info.playUrl.isEmpty()) return;
        EXECUTOR.execute(() -> {
            try {
                ExoPlayer player = new ExoPlayer.Builder(ctx.getApplicationContext()).build();
                DataSource.Factory factory = MobileMediaCache.dataSourceFactory(ctx, NativeAuth.getToken(ctx));
                MediaSource source;
                if (info.isHls()) {
                    source = new HlsMediaSource.Factory(factory)
                        .createMediaSource(MediaItem.fromUri(Uri.parse(info.playUrl)));
                } else {
                    source = new ProgressiveMediaSource.Factory(factory)
                        .createMediaSource(MediaItem.fromUri(Uri.parse(info.playUrl)));
                }
                player.setMediaSource(source);
                player.prepare();
                player.setPlayWhenReady(true);
                Thread.sleep(2500);
                player.release();
            } catch (Exception ignored) { }
        });
    }

    public static void stop(ExoPlayer player, PlayerView playerView, ImageButton muteButton) {
        stop(player, playerView, muteButton, null);
    }

    public static void stop(ExoPlayer player, PlayerView playerView, ImageButton muteButton,
                            @Nullable ImageView backdrop) {
        if (player != null) {
            player.setPlayWhenReady(false);
            player.release();
        }
        if (playerView != null) {
            playerView.setPlayer(null);
            playerView.setVisibility(View.GONE);
            playerView.setAlpha(0f);
        }
        if (muteButton != null) muteButton.setVisibility(View.GONE);
        if (backdrop != null) {
            backdrop.setVisibility(View.VISIBLE);
            backdrop.setAlpha(1f);
        }
    }

    private static boolean isHlsUrl(String playUrl) {
        if (playUrl == null) return false;
        String u = playUrl.toLowerCase();
        return u.contains(".m3u8") || u.contains("/api/trailers/stream/");
    }

    private static File diskIndexFile(Context ctx) {
        return new File(ctx.getCacheDir(), "trailer_index.json");
    }

    @Nullable
    private static VixApi.TrailerInfo readDiskEntry(Context ctx, String videoId) {
        try {
            File f = diskIndexFile(ctx);
            if (!f.exists()) return null;
            JSONObject root = new JSONObject(readFile(f));
            JSONObject entry = root.optJSONObject(videoId);
            if (entry == null) return null;
            long savedAt = entry.optLong("saved_at", 0);
            if (savedAt > 0 && System.currentTimeMillis() - savedAt > DISK_TTL_MS) return null;
            String url = entry.optString("play_url", "");
            if (url.isEmpty()) return null;
            return new VixApi.TrailerInfo(videoId, url, entry.optString("mime", ""));
        } catch (Exception e) {
            return null;
        }
    }

    private static void writeDiskEntry(Context ctx, VixApi.TrailerInfo info) {
        try {
            File f = diskIndexFile(ctx);
            JSONObject root;
            if (f.exists()) root = new JSONObject(readFile(f));
            else root = new JSONObject();
            JSONObject entry = new JSONObject();
            entry.put("play_url", info.playUrl);
            entry.put("mime", info.mime);
            entry.put("saved_at", System.currentTimeMillis());
            root.put(info.videoId, entry);
            pruneOldEntries(root);
            writeFile(f, root.toString());
        } catch (Exception ignored) { }
    }

    private static void pruneOldEntries(JSONObject root) {
        long now = System.currentTimeMillis();
        java.util.List<String> remove = new java.util.ArrayList<>();
        Iterator<String> keys = root.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            JSONObject e = root.optJSONObject(k);
            if (e == null) continue;
            long savedAt = e.optLong("saved_at", 0);
            if (savedAt > 0 && now - savedAt > DISK_TTL_MS) remove.add(k);
        }
        for (String k : remove) root.remove(k);
    }

    private static String readFile(File f) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
        }
        return sb.toString();
    }

    private static void writeFile(File f, String text) throws Exception {
        try (BufferedWriter w = new BufferedWriter(new FileWriter(f, false))) {
            w.write(text);
        }
    }
}
