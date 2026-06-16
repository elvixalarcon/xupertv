package tv.vix.app;

import android.content.Context;
import android.net.Uri;

import androidx.annotation.Nullable;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;

import java.util.Collections;
import java.util.Map;
import java.util.WeakHashMap;

/** Reproducción en vivo (HLS) — buffers amplios para OBS 1080p (~6 Mbps). */
public final class LivePlayerHelper {
    private static final Map<ExoPlayer, Player.Listener> OBS_LISTENERS = new WeakHashMap<>();

    private LivePlayerHelper() {}

    /** ExoPlayer con buffer grande para segmentos TS pesados de nginx-rtmp. */
    public static ExoPlayer createPlayer(Context ctx) {
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
            .setBufferDurationsMs(
                25_000,
                90_000,
                2_500,
                6_000
            )
            .setPrioritizeTimeOverSizeThresholds(true)
            .build();
        return new ExoPlayer.Builder(ctx)
            .setLoadControl(loadControl)
            .build();
    }

    public static DefaultHttpDataSource.Factory httpFactory(String userAgent, @Nullable String authToken) {
        DefaultHttpDataSource.Factory factory = new DefaultHttpDataSource.Factory()
            .setUserAgent(userAgent)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(45_000);
        if (authToken != null && !authToken.isEmpty()) {
            factory.setDefaultRequestProperties(
                Collections.singletonMap("Authorization", "Bearer " + authToken));
        }
        return factory;
    }

    public static MediaSource buildSource(String url, DefaultHttpDataSource.Factory dataFactory) {
        if (url == null || url.isEmpty()) return null;
        if (PlayUrls.isHlsPlaybackUrl(url)) {
            boolean obs = PlayUrls.isObsLiveUrl(url);
            HlsMediaSource.Factory hlsFactory = new HlsMediaSource.Factory(dataFactory)
                .setAllowChunklessPreparation(!obs);
            MediaItem.Builder item = new MediaItem.Builder().setUri(Uri.parse(url));
            if (obs) {
                item.setLiveConfiguration(new MediaItem.LiveConfiguration.Builder()
                    .setTargetOffsetMs(8_000)
                    .setMinPlaybackSpeed(0.97f)
                    .setMaxPlaybackSpeed(1.0f)
                    .build());
            }
            return hlsFactory.createMediaSource(item.build());
        }
        return new ProgressiveMediaSource.Factory(dataFactory)
            .createMediaSource(MediaItem.fromUri(Uri.parse(url)));
    }

    public static void start(ExoPlayer player, String url, String userAgent, @Nullable String authToken) {
        if (player == null || url == null || url.isEmpty()) return;
        Player.Listener prev = OBS_LISTENERS.remove(player);
        if (prev != null) player.removeListener(prev);
        DefaultHttpDataSource.Factory factory = httpFactory(userAgent, authToken);
        MediaSource source = buildSource(url, factory);
        if (source == null) return;
        player.setMediaSource(source);
        player.prepare();
        player.setPlayWhenReady(true);
        if (PlayUrls.isObsLiveUrl(url)) {
            final String u = url;
            final String ua = userAgent;
            final String t = authToken;
            Player.Listener listener = new Player.Listener() {
                @Override
                public void onPlayerError(androidx.media3.common.PlaybackException error) {
                    OBS_LISTENERS.remove(player);
                    player.removeListener(this);
                    try {
                        player.seekToDefaultPosition();
                        player.prepare();
                        player.setPlayWhenReady(true);
                    } catch (Exception ignored) {
                        player.stop();
                        player.clearMediaItems();
                        start(player, u, ua, t);
                    }
                }
            };
            OBS_LISTENERS.put(player, listener);
            player.addListener(listener);
        }
    }
}
