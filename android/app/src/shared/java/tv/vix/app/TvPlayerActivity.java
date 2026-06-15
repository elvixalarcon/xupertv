package tv.vix.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;

import org.json.JSONArray;
import org.json.JSONObject;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.ui.PlayerView;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class TvPlayerActivity extends AppCompatActivity {
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_VIDEO_PATH = "video_path";
    public static final String EXTRA_LIVE_CHANNEL_ID = "live_channel_id";
    public static final String EXTRA_START_SEC = "start_sec";
    public static final String EXTRA_START_MS = "start_ms";
    public static final String EXTRA_CONTENT_TYPE = "content_type";
    public static final String EXTRA_CONTENT_ID = "content_id";
    public static final String EXTRA_SERIES_ID = "series_id";
    public static final String EXTRA_POSITION_MS = "position_ms";
    public static final String EXTRA_DURATION_MS = "duration_ms";
    public static final String EXTRA_PREVIEW_IMAGE = TvPreviewExtras.EXTRA_PREVIEW_IMAGE;

    private static final long SAVE_INTERVAL_MS = 10000;
    private static final long ACTIVITY_INTERVAL_MS = 8000;
    /** Toque corto: avance/retroceso de 10 s. */
    private static final long SEEK_TAP_MS = 10_000L;
    private static final long VOD_HINT_MS = 1200L;
    private static final String GROUP_ALL = "Todos";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());

    private ExoPlayer player;
    private PlayerView playerView;
    private RadioVisualizerView radioVisualizer;
    private ImageView playerPlaceholder;
    private TextView vodHint;
    private String serverBase = "";
    private String authToken = "";
    private String contentType;
    private int contentId;
    private int seriesId;
    private boolean isVod;
    private boolean isLive;
    private int liveChannelId;
    private String playTitle = "";
    private String playerSessionKey = "main";
    private long lastSavedSec = -1;
    private long pendingSeekMs;
    private boolean resultSent;

    private View categoryDrawer;
    private View channelDrawer;
    private RecyclerView fsCategories;
    private RecyclerView fsChannels;
    private TextView fsChannelTitle;
    private TextView fsHint;
    private final Map<Integer, String> epgNowByChannel = new HashMap<>();
    private final List<LiveChannel> allLiveChannels = new ArrayList<>();
    private final List<LiveChannel> displayLiveChannels = new ArrayList<>();
    private final List<String> categoryNames = new ArrayList<>();
    private String activeGroup = null;
    private int selectedCategoryPos;
    private boolean channelPanelOpen;
    private boolean categoryPanelOpen;
    private FsChannelAdapter channelAdapter;
    private FsCategoryAdapter categoryAdapter;

    private final Runnable saveRunnable = this::saveProgressThrottled;
    private final Runnable activityHeartbeatRunnable = this::sendActivityHeartbeat;
    private final Runnable hideHintRunnable = () -> {
        if (fsHint != null) fsHint.setVisibility(View.GONE);
    };
    private final Runnable hideVodHintRunnable = () -> {
        if (vodHint != null) vodHint.setVisibility(View.GONE);
    };
    private Runnable seekHoldRunnable;
    private int seekHoldDirection;
    private int seekHoldTicks;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TvPreviewExtras.applyInstantTransition(this);
        setContentView(R.layout.activity_tv_player);
        if ("tv".equals(BuildConfig.PLATFORM)) {
            hideSystemUi();
        }

        serverBase = ServerUrlHelper.fromPrefs(getSharedPreferences(AppConstants.PREFS, MODE_PRIVATE));
        authToken = NativeAuth.getToken(this);

        String videoPath = getIntent().getStringExtra(EXTRA_VIDEO_PATH);
        liveChannelId = getIntent().getIntExtra(EXTRA_LIVE_CHANNEL_ID, 0);
        isLive = liveChannelId > 0;
        long startMs = getIntent().getLongExtra(EXTRA_START_MS, 0);
        if (startMs <= 0) {
            long startSec = getIntent().getLongExtra(EXTRA_START_SEC, 0);
            if (startSec > 0) startMs = startSec * 1000L;
        }
        contentType = getIntent().getStringExtra(EXTRA_CONTENT_TYPE);
        contentId = getIntent().getIntExtra(EXTRA_CONTENT_ID, 0);
        seriesId = getIntent().getIntExtra(EXTRA_SERIES_ID, 0);
        playTitle = getIntent().getStringExtra(EXTRA_TITLE);
        if (playTitle == null) playTitle = "";
        isVod = !isLive && contentType != null && contentId > 0;
        playerSessionKey = ActivitySession.playerKey(this);

        playerView = findViewById(R.id.tv_player_view);
        boolean mobilePlayer = "mobile".equals(BuildConfig.PLATFORM);
        if (mobilePlayer && !isLive) {
            playerView.setUseController(true);
            playerView.setControllerAutoShow(true);
            playerView.setControllerShowTimeoutMs(4000);
            playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);
        } else {
            playerView.setUseController(false);
            playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER);
        }
        PlaybackScreenWake.keepOn(this, playerView);
        playerPlaceholder = findViewById(R.id.tv_player_placeholder);
        vodHint = findViewById(R.id.tv_vod_hint);
        bindPlayerPlaceholder();

        String playUrl;
        if (isLive) {
            playUrl = PlayUrls.live(serverBase, authToken, liveChannelId, playerSessionKey);
            setupLiveOverlays();
        } else {
            playUrl = PlayUrls.videoWithActivity(
                serverBase,
                authToken,
                videoPath,
                playerSessionKey,
                playTitle,
                contentType != null ? contentType : "movie",
                contentId
            );
        }

        if (playUrl == null || playUrl.isEmpty()) {
            Toast.makeText(this, "Video no disponible", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        pendingSeekMs = startMs;
        startPlayback(playUrl);
        startActivityHeartbeat();
        if (isVod) handler.postDelayed(saveRunnable, SAVE_INTERVAL_MS);
    }

    private void startActivityHeartbeat() {
        handler.removeCallbacks(activityHeartbeatRunnable);
        sendActivityHeartbeat();
        handler.postDelayed(activityHeartbeatRunnable, ACTIVITY_INTERVAL_MS);
    }

    private void stopActivityHeartbeat() {
        handler.removeCallbacks(activityHeartbeatRunnable);
        final String sid = playerSessionKey;
        executor.execute(() -> new VixApi(this).sendActivityOffline(sid));
    }

    private void sendActivityHeartbeat() {
        handler.postDelayed(activityHeartbeatRunnable, ACTIVITY_INTERVAL_MS);
        long progressSec = 0;
        long durationSec = 0;
        if (player != null) {
            progressSec = Math.max(0, player.getCurrentPosition() / 1000L);
            long dur = player.getDuration();
            if (dur > 0) durationSec = dur / 1000L;
        }
        String status;
        String page;
        String title = playTitle;
        String ctype;
        int cid;
        if (isLive) {
            status = "watching_live";
            page = "live";
            LiveChannel ch = findLiveChannel(liveChannelId);
            if ((title == null || title.isEmpty()) && ch != null) title = ch.name;
            ctype = "live";
            cid = liveChannelId;
        } else if ("episode".equals(contentType)) {
            status = "watching_episode";
            page = "series";
            ctype = "episode";
            cid = contentId;
        } else if (isVod) {
            status = "watching_movie";
            page = "movies";
            ctype = "movie";
            cid = contentId;
        } else {
            status = "browsing";
            page = "player";
            ctype = "";
            cid = 0;
        }
        final String fStatus = status;
        final String fPage = page;
        final String fTitle = title != null ? title : "";
        final String fType = ctype;
        final int fCid = cid;
        final long fProg = progressSec;
        final long fDur = durationSec;
        final String sid = playerSessionKey;
        executor.execute(() -> new VixApi(TvPlayerActivity.this).sendActivityHeartbeat(
            fStatus, fPage, fTitle, fType, fCid, fProg, fDur, sid
        ));
    }

    private LiveChannel findLiveChannel(int id) {
        for (LiveChannel ch : allLiveChannels) {
            if (ch.id == id) return ch;
        }
        return null;
    }

    private void setupLiveOverlays() {
        radioVisualizer = findViewById(R.id.tv_player_radio_viz);
        categoryDrawer = findViewById(R.id.tv_fs_category_drawer);
        channelDrawer = findViewById(R.id.tv_fs_channel_drawer);
        fsCategories = findViewById(R.id.tv_fs_categories);
        fsChannels = findViewById(R.id.tv_fs_channels);
        fsChannelTitle = findViewById(R.id.tv_fs_channel_title);
        fsHint = findViewById(R.id.tv_fs_hint);

        fsCategories.setLayoutManager(new LinearLayoutManager(this));
        fsChannels.setLayoutManager(new LinearLayoutManager(this));
        fsChannels.setItemAnimator(null);
        fsCategories.setItemAnimator(null);
        categoryAdapter = new FsCategoryAdapter();
        channelAdapter = new FsChannelAdapter();
        fsCategories.setAdapter(categoryAdapter);
        fsChannels.setAdapter(channelAdapter);

        if (fsHint != null) {
            fsHint.setVisibility(View.VISIBLE);
            handler.postDelayed(hideHintRunnable, 5000);
        }

        executor.execute(() -> {
            try {
                VixApi api = new VixApi(this);
                JSONArray arr = api.liveChannels(null);
                Map<Integer, String> epgMap = new HashMap<>();
                try {
                    JSONObject epgRoot = api.liveEpg();
                    JSONObject epg = epgRoot.optJSONObject("epg");
                    if (epg != null) {
                        java.util.Iterator<String> keys = epg.keys();
                        while (keys.hasNext()) {
                            String key = keys.next();
                            JSONObject entry = epg.optJSONObject(key);
                            if (entry == null) continue;
                            JSONObject now = entry.optJSONObject("now");
                            if (now == null) continue;
                            String title = now.optString("title", "").trim();
                            String range = now.optString("range", "").trim();
                            String line = title.isEmpty() ? range : (range.isEmpty() ? title : title + " · " + range);
                            try {
                                epgMap.put(Integer.parseInt(key), line);
                            } catch (NumberFormatException ignored) { /* */ }
                        }
                    }
                } catch (Exception ignored) { /* EPG opcional */ }
                List<LiveChannel> list = new ArrayList<>();
                Set<String> groups = new LinkedHashSet<>();
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject ch = arr.getJSONObject(i);
                    String group = ch.optString("group_title", "").trim();
                    if (!group.isEmpty()) groups.add(group);
                    int cid = ch.optInt("id", 0);
                    String epgLine = epgMap.getOrDefault(cid, group.isEmpty() ? "En vivo" : group);
                    list.add(new LiveChannel(
                        cid,
                        ch.optString("name", ""),
                        ch.optString("logo", ""),
                        group,
                        epgLine,
                        ch.optBoolean("radio", false) || RadioVisualizerView.isRadioGroup(group),
                        ch.optString("stream_url", ""),
                        ch.optInt("direct_source", 0) == 1,
                        ch.optString("playback_referer", "")
                    ));
                }
                List<String> cats = new ArrayList<>();
                cats.add(GROUP_ALL);
                boolean hasRadio = false;
                for (LiveChannel ch : list) {
                    if (ch.radio || RadioVisualizerView.isRadioGroup(ch.group)) {
                        hasRadio = true;
                        break;
                    }
                }
                if (hasRadio) cats.add("Radio Ecuador");
                List<String> sorted = new ArrayList<>(groups);
                for (String g : new ArrayList<>(sorted)) {
                    if (RadioVisualizerView.isRadioGroup(g)) sorted.remove(g);
                }
                Collections.sort(sorted, String::compareToIgnoreCase);
                cats.addAll(sorted);
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    epgNowByChannel.clear();
                    epgNowByChannel.putAll(epgMap);
                    allLiveChannels.clear();
                    allLiveChannels.addAll(list);
                    categoryNames.clear();
                    categoryNames.addAll(cats);
                    selectedCategoryPos = 0;
                    activeGroup = null;
                    rebuildDisplayChannels();
                    categoryAdapter.notifyDataSetChanged();
                    channelAdapter.notifyDataSetChanged();
                    updateLiveRadioUi(findLiveChannel(liveChannelId));
                    LiveChannel current = findLiveChannel(liveChannelId);
                    if (current != null && PlayUrls.isDirectLiveChannel(current.directSource, current.streamUrl)) {
                        String url = PlayUrls.livePlayback(
                            serverBase, authToken, current.id,
                            current.streamUrl, current.directSource,
                            current.radio, current.playbackReferer, playerSessionKey);
                        startPlayback(url);
                    }
                });
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(this,
                    e.getMessage() != null ? e.getMessage() : "Error cargando canales",
                    Toast.LENGTH_SHORT).show());
            }
        });
    }

    private void rebuildDisplayChannels() {
        displayLiveChannels.clear();
        for (LiveChannel ch : allLiveChannels) {
            if (activeGroup == null || activeGroup.isEmpty()) {
                displayLiveChannels.add(ch);
            } else if (activeGroup.equals(ch.group)) {
                displayLiveChannels.add(ch);
            }
        }
        if (channelAdapter != null) channelAdapter.notifyDataSetChanged();
        updateChannelDrawerTitle();
    }

    private void updateChannelDrawerTitle() {
        if (fsChannelTitle == null) return;
        String label = activeGroup == null || activeGroup.isEmpty()
            ? "Canales"
            : "Canales · " + activeGroup;
        fsChannelTitle.setText(label);
    }

    private void hideSystemUi() {
        PlaybackScreenWake.keepOn(this, playerView);
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );
    }

    private void startPlayback(String url) {
        if (isLive) {
            if (player != null) {
                player.stop();
                player.clearMediaItems();
            } else {
                player = LivePlayerHelper.createPlayer(this);
                playerView.setPlayer(player);
                attachVodPlayerListener();
            }
            LivePlayerHelper.start(player, url, "VixTV/1.0 tv", authToken);
            return;
        }

        DefaultHttpDataSource.Factory dataFactory = new DefaultHttpDataSource.Factory()
            .setUserAgent("VixTV/1.0 tv")
            .setAllowCrossProtocolRedirects(true);
        if (url.contains("token=")) {
            dataFactory.setDefaultRequestProperties(
                java.util.Collections.singletonMap("Authorization", "Bearer " + authToken)
            );
        }

        MediaSource source;
        if (PlayUrls.isHlsPlaybackUrl(url)) {
            source = new HlsMediaSource.Factory(dataFactory).createMediaSource(MediaItem.fromUri(Uri.parse(url)));
        } else {
            source = new ProgressiveMediaSource.Factory(dataFactory)
                .createMediaSource(MediaItem.fromUri(Uri.parse(url)));
        }

        if (player != null) {
            player.stop();
            player.clearMediaItems();
        } else {
            player = LivePlayerHelper.createPlayer(this);
            playerView.setPlayer(player);
            attachVodPlayerListener();
        }
        player.setMediaSource(source);
        player.prepare();
        player.setPlayWhenReady(true);
    }

    private void attachVodPlayerListener() {
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY && pendingSeekMs > 0 && player != null) {
                    player.seekTo(pendingSeekMs);
                    pendingSeekMs = 0;
                }
                if (state == Player.STATE_READY && player != null && player.isPlaying()) {
                    hidePlayerPlaceholder();
                }
                if (state == Player.STATE_ENDED && isVod && "episode".equals(contentType) && seriesId > 0) {
                    playNextEpisodeAuto();
                }
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) hidePlayerPlaceholder();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                String msg = error.getMessage() != null ? error.getMessage() : "Error de reproducción";
                Toast.makeText(TvPlayerActivity.this, msg, Toast.LENGTH_LONG).show();
            }
        });
    }

    private void updateLiveRadioUi(LiveChannel ch) {
        if (!isLive || radioVisualizer == null) return;
        boolean radio = ch != null && ch.radio;
        radioVisualizer.setActive(radio);
        if (radio && ch != null) {
            radioVisualizer.bind(ch.name, ch.logo, serverBase);
        }
        if (playerView != null) {
            playerView.setVisibility(radio ? View.INVISIBLE : View.VISIBLE);
        }
    }

    private void switchLiveChannel(LiveChannel ch) {
        if (ch == null || ch.id <= 0) return;
        liveChannelId = ch.id;
        updateLiveRadioUi(ch);
        String url = PlayUrls.livePlayback(
            serverBase, authToken, ch.id, ch.streamUrl, ch.directSource,
            ch.radio, ch.playbackReferer, playerSessionKey);
        if (url == null || url.isEmpty()) {
            Toast.makeText(this, "Canal no disponible", Toast.LENGTH_SHORT).show();
            return;
        }
        startPlayback(url);
        startActivityHeartbeat();
        closeAllPanels();
    }

    private void closeAllPanels() {
        channelPanelOpen = false;
        categoryPanelOpen = false;
        if (channelDrawer != null) channelDrawer.setVisibility(View.GONE);
        if (categoryDrawer != null) categoryDrawer.setVisibility(View.GONE);
    }

    private void openChannelPanel() {
        if (displayLiveChannels.isEmpty()) return;
        channelPanelOpen = true;
        if (channelDrawer != null) channelDrawer.setVisibility(View.VISIBLE);
        focusChannelAtCurrent();
    }

    private void closeChannelPanelOnly() {
        channelPanelOpen = false;
        if (channelDrawer != null) channelDrawer.setVisibility(View.GONE);
    }

    private void openChannelPanelForCategory(int pos) {
        if (pos < 0 || pos >= categoryNames.size()) return;
        selectedCategoryPos = pos;
        String name = categoryNames.get(pos);
        activeGroup = GROUP_ALL.equals(name) ? null : name;
        rebuildDisplayChannels();
        categoryAdapter.notifyDataSetChanged();
        channelAdapter.notifyDataSetChanged();
        categoryPanelOpen = true;
        if (categoryDrawer != null) categoryDrawer.setVisibility(View.VISIBLE);
        openChannelPanel();
    }

    private void toggleCategoryPanel() {
        if (categoryNames.isEmpty()) return;
        if (categoryPanelOpen) {
            closeAllPanels();
            return;
        }
        channelPanelOpen = false;
        if (channelDrawer != null) channelDrawer.setVisibility(View.GONE);
        categoryPanelOpen = true;
        if (categoryDrawer != null) categoryDrawer.setVisibility(View.VISIBLE);
        focusCategory(selectedCategoryPos);
    }

    private void focusCategory(int pos) {
        if (fsCategories == null) return;
        fsCategories.post(() -> {
            RecyclerView.ViewHolder h = fsCategories.findViewHolderForAdapterPosition(pos);
            View target = h != null ? h.itemView.findViewById(R.id.tv_grp_inner) : null;
            if (target != null) target.requestFocus();
            else fsCategories.requestFocus();
        });
    }

    private void focusChannelAtCurrent() {
        if (fsChannels == null) return;
        int pos = 0;
        for (int i = 0; i < displayLiveChannels.size(); i++) {
            if (displayLiveChannels.get(i).id == liveChannelId) {
                pos = i;
                break;
            }
        }
        int finalPos = pos;
        fsChannels.post(() -> {
            RecyclerView.ViewHolder h = fsChannels.findViewHolderForAdapterPosition(finalPos);
            View target = h != null ? h.itemView.findViewById(R.id.tv_ch_inner) : null;
            if (target != null) target.requestFocus();
            else fsChannels.requestFocus();
        });
    }

    private void selectCategory(int pos) {
        openChannelPanelForCategory(pos);
    }

    private void saveProgressThrottled() {
        if (!isVod || player == null) return;
        long posSec = player.getCurrentPosition() / 1000L;
        long durSec = player.getDuration() > 0 ? player.getDuration() / 1000L : 0;
        if (posSec < 5) {
            handler.postDelayed(saveRunnable, SAVE_INTERVAL_MS);
            return;
        }
        if (lastSavedSec >= 0 && Math.abs(posSec - lastSavedSec) < 8) {
            handler.postDelayed(saveRunnable, SAVE_INTERVAL_MS);
            return;
        }
        lastSavedSec = posSec;
        final long p = posSec;
        final long d = durSec;
        executor.execute(() -> {
            try {
                new VixApi(TvPlayerActivity.this).saveWatchProgress(contentType, contentId, seriesId, p, d);
            } catch (Exception ignored) { }
        });
        handler.postDelayed(saveRunnable, SAVE_INTERVAL_MS);
    }

    private void saveProgressNow() {
        if (!isVod || player == null) return;
        long posSec = player.getCurrentPosition() / 1000L;
        long durSec = player.getDuration() > 0 ? player.getDuration() / 1000L : 0;
        if (posSec < 5) return;
        lastSavedSec = posSec;
        final long p = posSec;
        final long d = durSec;
        executor.execute(() -> {
            try {
                new VixApi(TvPlayerActivity.this).saveWatchProgress(contentType, contentId, seriesId, p, d);
            } catch (Exception ignored) { }
        });
    }

    private void returnPositionToCaller() {
        if (resultSent) return;
        resultSent = true;
        Intent data = new Intent();
        if (isLive) {
            data.putExtra(EXTRA_LIVE_CHANNEL_ID, liveChannelId);
        } else if (player != null) {
            data.putExtra(EXTRA_POSITION_MS, player.getCurrentPosition());
            data.putExtra(EXTRA_DURATION_MS, player.getDuration());
        }
        setResult(RESULT_OK, data);
    }

    private void bindPlayerPlaceholder() {
        if (playerPlaceholder == null) return;
        String preview = getIntent().getStringExtra(EXTRA_PREVIEW_IMAGE);
        if (preview == null || preview.isEmpty()) return;
        playerPlaceholder.setVisibility(View.VISIBLE);
        String url = PlayUrls.poster(serverBase, preview);
        if (!url.isEmpty()) {
            Glide.with(this).load(url).centerCrop().into(playerPlaceholder);
        }
    }

    private void hidePlayerPlaceholder() {
        if (playerPlaceholder != null) playerPlaceholder.setVisibility(View.GONE);
    }

    private void finishWithResult() {
        returnPositionToCaller();
        finish();
        TvPreviewExtras.applyInstantTransition(this);
    }

    @Override
    protected void onStart() {
        super.onStart();
        startActivityHeartbeat();
    }

    @Override
    protected void onPause() {
        saveProgressNow();
        if (player != null) player.setPlayWhenReady(false);
        super.onPause();
    }

    @Override
    protected void onStop() {
        handler.removeCallbacks(saveRunnable);
        handler.removeCallbacks(hideHintRunnable);
        saveProgressNow();
        if (player != null) player.setPlayWhenReady(false);
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        stopActivityHeartbeat();
        stopSeekHold();
        handler.removeCallbacksAndMessages(null);
        saveProgressNow();
        if (isVod || isLive) returnPositionToCaller();
        if (player != null) {
            player.release();
            player = null;
        }
        PlaybackScreenWake.release(this, playerView);
        executor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (isLive && event.getAction() == KeyEvent.ACTION_DOWN) {
            int keyCode = event.getKeyCode();
            if (keyCode == KeyEvent.KEYCODE_BACK) {
                if (channelPanelOpen) {
                    closeChannelPanelOnly();
                    focusCategory(selectedCategoryPos);
                    return true;
                }
                if (categoryPanelOpen) {
                    closeAllPanels();
                    return true;
                }
                finishWithResult();
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
                if (isFocusInChannelPanel()) {
                    focusCategory(selectedCategoryPos);
                    return true;
                }
                toggleCategoryPanel();
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                if (categoryPanelOpen || isFocusInCategoryPanel()) {
                    int catPos = selectedCategoryPos;
                    View focus = getCurrentFocus();
                    if (fsCategories != null && focus != null) {
                        RecyclerView.ViewHolder h = fsCategories.findContainingViewHolder(focus);
                        if (h != null && h.getBindingAdapterPosition() >= 0) {
                            catPos = h.getBindingAdapterPosition();
                        }
                    }
                    openChannelPanelForCategory(catPos);
                    return true;
                }
            }
            if (isSelectKey(keyCode) && categoryPanelOpen && !channelPanelOpen) {
                openChannelPanel();
                return true;
            }
            if (isSelectKey(keyCode) && !categoryPanelOpen && !channelPanelOpen) {
                openChannelPanel();
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private boolean isFocusInChannelPanel() {
        View focus = getCurrentFocus();
        return channelDrawer != null && focus != null
            && (focus == channelDrawer || isDescendantOf(channelDrawer, focus));
    }

    private boolean isFocusInCategoryPanel() {
        View focus = getCurrentFocus();
        return categoryDrawer != null && focus != null
            && (focus == categoryDrawer || isDescendantOf(categoryDrawer, focus));
    }

    private static boolean isDescendantOf(View parent, View child) {
        if (parent == null || child == null) return false;
        android.view.ViewParent p = child.getParent();
        while (p instanceof View) {
            if (p == parent) return true;
            p = p.getParent();
        }
        return false;
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (isLive) {
            return super.onKeyDown(keyCode, event);
        }

        if (keyCode == KeyEvent.KEYCODE_BACK) {
            stopSeekHold();
            finishWithResult();
            return true;
        }

        if (player != null && !isLive) {
            if (isPlayPauseKey(keyCode)) {
                if (event.getRepeatCount() == 0) togglePlayPause();
                return true;
            }
            int seekDir = seekDirectionForKey(keyCode);
            if (seekDir != 0) {
                if (event.getRepeatCount() == 0) {
                    seekRelative(seekDir * SEEK_TAP_MS);
                    startSeekHold(seekDir);
                }
                return true;
            }
        }

        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (!isLive && seekDirectionForKey(keyCode) != 0) {
            stopSeekHold();
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    private void togglePlayPause() {
        if (player == null) return;
        if (player.isPlaying()) {
            player.pause();
            showVodHint("Pausa");
        } else {
            player.play();
            showVodHint("Reproducir");
        }
    }

    private void seekRelative(long deltaMs) {
        if (player == null) return;
        long duration = player.getDuration();
        long pos = player.getCurrentPosition();
        long target = pos + deltaMs;
        if (duration > 0) {
            target = Math.max(0, Math.min(duration, target));
        } else {
            target = Math.max(0, target);
        }
        player.seekTo(target);
        showSeekHint(deltaMs);
    }

    private void showSeekHint(long deltaMs) {
        long absSec = Math.abs(deltaMs) / 1000L;
        String amount;
        if (absSec >= 120) {
            amount = (absSec / 60) + " min";
        } else if (absSec >= 60) {
            amount = "1 min";
        } else {
            amount = absSec + " s";
        }
        showVodHint((deltaMs >= 0 ? "+" : "−") + amount);
    }

    /** Saltos cada vez mayores y más rápidos mientras se mantiene ← o →. */
    private long seekStepForHoldTick() {
        if (seekHoldTicks <= 1) return 25_000L;
        if (seekHoldTicks <= 3) return 60_000L;
        if (seekHoldTicks <= 6) return 120_000L;
        return 180_000L;
    }

    private long seekDelayForHoldTick() {
        if (seekHoldTicks <= 2) return 320L;
        if (seekHoldTicks <= 5) return 220L;
        return 140L;
    }

    private void startSeekHold(int direction) {
        stopSeekHold();
        seekHoldDirection = direction;
        seekHoldTicks = 0;
        seekHoldRunnable = new Runnable() {
            @Override
            public void run() {
                if (player == null || seekHoldDirection == 0) return;
                seekHoldTicks++;
                long step = seekStepForHoldTick();
                seekRelative(seekHoldDirection * step);
                handler.postDelayed(this, seekDelayForHoldTick());
            }
        };
        handler.postDelayed(seekHoldRunnable, 450L);
    }

    private void stopSeekHold() {
        seekHoldDirection = 0;
        seekHoldTicks = 0;
        if (seekHoldRunnable != null) {
            handler.removeCallbacks(seekHoldRunnable);
            seekHoldRunnable = null;
        }
    }

    private void showVodHint(String text) {
        if (vodHint == null) return;
        vodHint.setText(text);
        vodHint.setVisibility(View.VISIBLE);
        handler.removeCallbacks(hideVodHintRunnable);
        handler.postDelayed(hideVodHintRunnable, VOD_HINT_MS);
    }

    private static boolean isPlayPauseKey(int keyCode) {
        return isSelectKey(keyCode)
            || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY
            || keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE
            || keyCode == KeyEvent.KEYCODE_SPACE;
    }

    private static int seekDirectionForKey(int keyCode) {
        if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT
            || keyCode == KeyEvent.KEYCODE_MEDIA_REWIND
            || keyCode == KeyEvent.KEYCODE_MINUS) {
            return -1;
        }
        if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT
            || keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD
            || keyCode == KeyEvent.KEYCODE_PLUS
            || keyCode == KeyEvent.KEYCODE_PAGE_DOWN) {
            return 1;
        }
        return 0;
    }

    private static boolean isSelectKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_DPAD_CENTER
            || keyCode == KeyEvent.KEYCODE_ENTER
            || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
            || keyCode == KeyEvent.KEYCODE_BUTTON_A;
    }

    @Override
    public void finish() {
        handler.removeCallbacks(saveRunnable);
        super.finish();
    }

    private void playNextEpisodeAuto() {
        if (!isVod || seriesId <= 0 || contentId <= 0) return;
        executor.execute(() -> {
            try {
                VixApi api = new VixApi(this);
                JSONObject detail = api.seriesDetail(seriesId);
                JSONArray eps = detail.optJSONArray("episodes");
                if (eps == null || eps.length() == 0) return;
                int nextIdx = -1;
                for (int i = 0; i < eps.length(); i++) {
                    if (eps.getJSONObject(i).optInt("id", 0) == contentId) {
                        nextIdx = i + 1;
                        break;
                    }
                }
                if (nextIdx < 0 || nextIdx >= eps.length()) return;
                JSONObject next = eps.getJSONObject(nextIdx);
                String path = next.optString("video_path", "");
                if (path.isEmpty()) return;
                int nextId = next.optInt("id", 0);
                String title = detail.optString("title", "") + " S"
                    + next.optInt("season", 0) + "E"
                    + String.format(Locale.ROOT, "%02d", next.optInt("episode", 0))
                    + " - " + next.optString("title", "");
                runOnUiThread(() -> {
                    if (isFinishing() || player == null) return;
                    contentId = nextId;
                    pendingSeekMs = 0;
                    lastSavedSec = -1;
                    Toast.makeText(this, "Siguiente episodio", Toast.LENGTH_SHORT).show();
                    startPlayback(PlayUrls.video(serverBase, authToken, path));
                });
            } catch (Exception ignored) { /* sin siguiente */ }
        });
    }

    private static class LiveChannel {
        final int id;
        final String name;
        final String logo;
        final String group;
        final String epgNow;
        final boolean radio;
        final String streamUrl;
        final boolean directSource;
        final String playbackReferer;

        LiveChannel(int id, String name, String logo, String group, String epgNow, boolean radio,
                    String streamUrl, boolean directSource, String playbackReferer) {
            this.id = id;
            this.name = name;
            this.logo = logo;
            this.group = group;
            this.epgNow = epgNow;
            this.radio = radio;
            this.streamUrl = streamUrl != null ? streamUrl : "";
            this.directSource = directSource;
            this.playbackReferer = playbackReferer != null ? playbackReferer : "";
        }
    }

    private class FsCategoryAdapter extends RecyclerView.Adapter<FsCategoryAdapter.GH> {
        @NonNull
        @Override
        public GH onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            return new GH(getLayoutInflater().inflate(R.layout.item_tv_fs_group, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull GH holder, int position) {
            String name = categoryNames.get(position);
            holder.label.setText(name);
            boolean selected = position == selectedCategoryPos;
            holder.label.setSelected(selected);
            holder.label.setOnFocusChangeListener((v, has) -> {
                holder.label.setSelected(has || position == selectedCategoryPos);
                if (has) selectedCategoryPos = position;
            });
            holder.label.setOnClickListener(v -> selectCategory(position));
            bindEnter(holder.label, () -> selectCategory(position));
            holder.label.setOnKeyListener((v, keyCode, ev) -> {
                if (ev.getAction() == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                    openChannelPanelForCategory(position);
                    return true;
                }
                return false;
            });
            if (fsChannels != null) {
                holder.label.setNextFocusRightId(fsChannels.getId());
            }
        }

        @Override
        public int getItemCount() {
            return categoryNames.size();
        }

        class GH extends RecyclerView.ViewHolder {
            final TextView label;

            GH(View itemView) {
                super(itemView);
                label = itemView.findViewById(R.id.tv_grp_inner);
            }
        }
    }

    private class FsChannelAdapter extends RecyclerView.Adapter<FsChannelAdapter.CH> {
        @NonNull
        @Override
        public CH onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            return new CH(getLayoutInflater().inflate(R.layout.item_tv_channel, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull CH holder, int position) {
            LiveChannel ch = displayLiveChannels.get(position);
            holder.num.setText(String.valueOf(position + 1));
            holder.name.setText(ch.name);
            holder.epg.setText(ch.epgNow != null && !ch.epgNow.isEmpty()
                ? ch.epgNow
                : (ch.group.isEmpty() ? "En vivo" : ch.group));
            boolean playing = ch.id == liveChannelId;
            holder.play.setVisibility(playing ? View.VISIBLE : View.INVISIBLE);
            String logoUrl = PlayUrls.poster(serverBase, ch.logo);
            if (logoUrl.isEmpty()) {
                holder.logo.setImageDrawable(null);
            } else {
                Glide.with(TvPlayerActivity.this).load(logoUrl).centerCrop().into(holder.logo);
            }
            if (fsCategories != null) {
                holder.inner.setNextFocusLeftId(fsCategories.getId());
            }
            holder.inner.setOnClickListener(v -> switchLiveChannel(ch));
            bindEnter(holder.inner, () -> switchLiveChannel(ch));
            holder.inner.setOnKeyListener((v, keyCode, ev) -> {
                if (ev.getAction() == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
                    focusCategory(selectedCategoryPos);
                    return true;
                }
                return false;
            });
        }

        @Override
        public int getItemCount() {
            return displayLiveChannels.size();
        }

        class CH extends RecyclerView.ViewHolder {
            final View inner;
            final TextView num;
            final TextView name;
            final TextView epg;
            final ImageView logo;
            final TextView play;

            CH(View itemView) {
                super(itemView);
                inner = itemView.findViewById(R.id.tv_ch_inner);
                num = itemView.findViewById(R.id.tv_ch_num);
                name = itemView.findViewById(R.id.tv_ch_name);
                epg = itemView.findViewById(R.id.tv_ch_epg);
                logo = itemView.findViewById(R.id.tv_ch_logo);
                play = itemView.findViewById(R.id.tv_ch_play);
            }
        }
    }

    private void bindEnter(View v, Runnable action) {
        v.setOnKeyListener((view, keyCode, ev) -> {
            if (ev.getAction() == KeyEvent.ACTION_DOWN && isSelectKey(keyCode)) {
                action.run();
                return true;
            }
            return false;
        });
    }
}
