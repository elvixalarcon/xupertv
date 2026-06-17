package com.vixmusic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MediaPlaybackService extends Service {
    public static final String CHANNEL_ID = "vixmusic_playback";
    private static final int NOTIFICATION_ID = 1001;

    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_IMAGE_URL = "imageUrl";
    public static final String EXTRA_PLAYING = "playing";
    public static final String EXTRA_PLAY_URL = "playUrl";
    public static final String EXTRA_ACTION = "action";
    public static final String EXTRA_VOLUME = "volume";

    public static final String ACTION_PAUSE = "pause";
    public static final String ACTION_RESUME = "resume";
    public static final String ACTION_STOP = "stop";

    private static MediaPlaybackService instance;

    private MediaSessionCompat mediaSession;
    private ExoPlayer exoPlayer;
    private PowerManager.WakeLock wakeLock;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private String title = "VixMusic";
    private String artist = "";
    private String imageUrl = "";
    private String currentPlayUrl = "";
    private boolean playing = false;
    private float volume = 1f;
    private Bitmap artwork;

    public static MediaPlaybackService getInstance() {
        return instance;
    }

    @Nullable
    public ExoPlayer getExoPlayer() {
        return exoPlayer;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannel();
        mediaSession = new MediaSessionCompat(this, "VixMusicPlayback");
        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                resumePlayback();
                MediaActionBridge.dispatch("play");
            }

            @Override
            public void onPause() {
                pausePlayback();
                MediaActionBridge.dispatch("pause");
            }

            @Override
            public void onSkipToNext() {
                MediaActionBridge.dispatch("next");
            }

            @Override
            public void onSkipToPrevious() {
                MediaActionBridge.dispatch("prev");
            }
        });
        mediaSession.setActive(true);
        ensurePlayer();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            if (intent.hasExtra(EXTRA_TITLE)) {
                title = safeString(intent.getStringExtra(EXTRA_TITLE), "VixMusic");
            }
            if (intent.hasExtra(EXTRA_ARTIST)) {
                artist = safeString(intent.getStringExtra(EXTRA_ARTIST), "");
            }
            if (intent.hasExtra(EXTRA_IMAGE_URL)) {
                String nextImage = safeString(intent.getStringExtra(EXTRA_IMAGE_URL), "");
                if (!nextImage.equals(imageUrl)) {
                    imageUrl = nextImage;
                    loadArtwork(imageUrl);
                }
            }
            if (intent.hasExtra(EXTRA_VOLUME)) {
                volume = Math.max(0f, Math.min(1f, intent.getFloatExtra(EXTRA_VOLUME, 1f)));
                if (exoPlayer != null) {
                    exoPlayer.setVolume(volume);
                }
            }

            String action = intent.getStringExtra(EXTRA_ACTION);
            if (ACTION_STOP.equals(action)) {
                stopPlaybackInternal();
                stopSelf();
                return START_NOT_STICKY;
            }
            if (ACTION_PAUSE.equals(action)) {
                pausePlayback();
                return START_STICKY;
            }
            if (ACTION_RESUME.equals(action)) {
                resumePlayback();
                return START_STICKY;
            }

            String playUrl = intent.getStringExtra(EXTRA_PLAY_URL);
            if (playUrl != null && !playUrl.isEmpty()) {
                startPlayback(playUrl);
            } else if (intent.hasExtra(EXTRA_PLAYING)) {
                if (intent.getBooleanExtra(EXTRA_PLAYING, true)) {
                    resumePlayback();
                } else {
                    pausePlayback();
                }
            }
        }

        acquireWakeLock();
        updateSessionMetadata();
        updateSessionState();
        startForeground(NOTIFICATION_ID, buildNotification());
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopPlaybackInternal();
        releaseWakeLock();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        executor.shutdownNow();
        stopForeground(STOP_FOREGROUND_REMOVE);
        instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void ensurePlayer() {
        if (exoPlayer != null) return;
        exoPlayer = new ExoPlayer.Builder(this).build();
        exoPlayer.setVolume(volume);
        exoPlayer.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                playing = isPlaying;
                updateSessionState();
                refreshNotification();
                MediaActionBridge.dispatchPlayback(
                    isPlaying ? "playing" : "paused",
                    exoPlayer.getCurrentPosition(),
                    exoPlayer.getDuration()
                );
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_ENDED) {
                    playing = false;
                    updateSessionState();
                    refreshNotification();
                    MediaActionBridge.dispatch("ended");
                    MediaActionBridge.dispatchPlayback(
                        "ended",
                        exoPlayer.getDuration(),
                        exoPlayer.getDuration()
                    );
                }
                if (playbackState == Player.STATE_READY) {
                    MediaActionBridge.dispatchPlayback(
                        "ready",
                        exoPlayer.getCurrentPosition(),
                        exoPlayer.getDuration()
                    );
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                playing = false;
                updateSessionState();
                refreshNotification();
                MediaActionBridge.dispatchPlayback("error", 0, 0);
            }
        });
    }

    private void startPlayback(String playUrl) {
        ensurePlayer();
        if (playUrl.equals(currentPlayUrl) && exoPlayer.getPlaybackState() != Player.STATE_IDLE) {
            exoPlayer.setPlayWhenReady(true);
            playing = true;
            updateSessionState();
            refreshNotification();
            return;
        }
        currentPlayUrl = playUrl;
        exoPlayer.setMediaItem(MediaItem.fromUri(playUrl));
        exoPlayer.prepare();
        exoPlayer.setPlayWhenReady(true);
        playing = true;
        updateSessionMetadata();
        updateSessionState();
        refreshNotification();
    }

    private void pausePlayback() {
        if (exoPlayer != null) {
            exoPlayer.pause();
        }
        playing = false;
        updateSessionState();
        refreshNotification();
    }

    private void resumePlayback() {
        if (exoPlayer != null) {
            exoPlayer.play();
        }
        playing = true;
        updateSessionState();
        refreshNotification();
    }

    private void stopPlaybackInternal() {
        currentPlayUrl = "";
        if (exoPlayer != null) {
            exoPlayer.stop();
            exoPlayer.clearMediaItems();
        }
        playing = false;
    }

    private void refreshNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private Notification buildNotification() {
        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent prevIntent = buildActionIntent("prev", 1);
        PendingIntent playPauseIntent = buildActionIntent(playing ? "pause" : "play", 2);
        PendingIntent nextIntent = buildActionIntent("next", 3);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(artist.isEmpty() ? "Reproduciendo música" : artist)
            .setSubText("VixMusic")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setLargeIcon(artwork)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .addAction(R.drawable.ic_media_previous, "Anterior", prevIntent)
            .addAction(
                playing ? R.drawable.ic_media_pause : R.drawable.ic_media_play,
                playing ? "Pausa" : "Reproducir",
                playPauseIntent
            )
            .addAction(R.drawable.ic_media_next, "Siguiente", nextIntent)
            .setStyle(
                new MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2)
            );

        return builder.build();
    }

    private PendingIntent buildActionIntent(String action, int requestCode) {
        Intent intent = new Intent(this, MediaActionReceiver.class);
        intent.setAction(action);
        return PendingIntent.getBroadcast(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void updateSessionMetadata() {
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, "VixMusic");
        if (artwork != null) {
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artwork);
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, artwork);
        }
        mediaSession.setMetadata(meta.build());
    }

    private void updateSessionState() {
        long position = exoPlayer != null ? exoPlayer.getCurrentPosition() : 0;
        long actions = PlaybackStateCompat.ACTION_PLAY
            | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS;
        int state = playing
            ? PlaybackStateCompat.STATE_PLAYING
            : PlaybackStateCompat.STATE_PAUSED;
        mediaSession.setPlaybackState(
            new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, position, playing ? 1f : 0f)
                .build()
        );
    }

    private void loadArtwork(String url) {
        if (url == null || url.isEmpty()) {
            artwork = null;
            updateSessionMetadata();
            refreshNotification();
            return;
        }
        executor.execute(() -> {
            Bitmap bitmap = null;
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setDoInput(true);
                conn.connect();
                InputStream in = conn.getInputStream();
                bitmap = BitmapFactory.decodeStream(in);
                in.close();
                conn.disconnect();
            } catch (Exception ignored) {
                /* sin portada */
            }
            Bitmap finalBitmap = bitmap;
            mainHandler.post(() -> {
                artwork = finalBitmap;
                updateSessionMetadata();
                refreshNotification();
            });
        });
    }

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "VixMusic::Playback");
                wakeLock.setReferenceCounted(false);
            }
        }
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(10 * 60 * 60 * 1000L);
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Reproducción de música",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Controles de reproducción en segundo plano");
        channel.setShowBadge(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private static String safeString(String value, String fallback) {
        if (value == null || value.trim().isEmpty()) return fallback;
        return value.trim();
    }
}
