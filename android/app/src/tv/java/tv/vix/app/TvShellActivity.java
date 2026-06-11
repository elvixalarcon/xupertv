package tv.vix.app;

import android.content.Intent;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.ui.PlayerView;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class TvShellActivity extends AppCompatActivity {
    public static final String EXTRA_LIVE_CHANNEL_ID = "live_channel_id";

    private static final int SEC_HOME = 0;
    private static final int SEC_LIVE = 1;
    private static final int SEC_DESTACADOS = 2;
    private static final int SEC_MOVIES = 3;
    private static final int SEC_SERIES = 4;
    private static final int SEC_KIDS = 5;
    private static final int SEC_ANIME = 6;
    private static final int SEC_EXPLORE = 7;
    private static final long HERO_ROTATE_MS = 4200;
    private static final long LIVE_ZAP_OSD_MS = 5000;
    /** Portadas visibles por fila; el resto en Ver más. */
    private static final int ROW_PREVIEW_MAX = 10;
    private static final String GROUP_ALL = "Todos";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<ChannelItem> channels = new ArrayList<>();
    private final List<ChannelItem> visibleChannels = new ArrayList<>();
    private final List<String> liveCategoryNames = new ArrayList<>();
    private final List<CatalogRow> catalogRows = new ArrayList<>();
    private final List<CatalogItem> heroRotating = new ArrayList<>();
    private final CatalogItem[] heroBottomTiles = new CatalogItem[4];

    private View panelLive;
    private View panelCatalog;
    private TextView navHome, navLive, navDestacados, navMovies, navSeries, navKids, navAnime, navExplore;
    private TextView clockView;
    private TextView notifyBadge;
    private TextView liveNowTitle;
    private RecyclerView liveChannelsList;
    private boolean heroInCatalogList;
    private View livePlayerWrap;
    private View liveBodyRow;
    private View tvSidebar;
    private View tvTopBar;
    private TextView liveFullscreenBtn;
    private ImageView heroSlideImg;
    private TextView heroSlideTitle;
    private ImageView heroFixedImg;
    private LinearLayout heroDots;
    private final TextView[] heroTileTitles = new TextView[4];
    private View heroSlideWrap;
    private View heroFixedWrap;
    private final ImageView[] heroTileImgs = new ImageView[4];
    private final View[] heroTileWraps = new View[4];
    private CatalogItem heroFixedItem;
    private int heroRotateIndex;
    private RecyclerView catalogList;
    private ProgressBar catalogLoading;
    private TextView catalogEmpty;
    private TextView liveEmpty;
    private View liveRoot;
    private View liveChannelDrawer;
    private View liveCategoryDrawer;
    private View liveFsChannelDrawer;
    private RecyclerView liveCategoriesList;
    private RecyclerView liveFsChannelsList;
    private TextView liveOverlayHint;
    private View liveZapOsd;
    private ImageView liveZapLogo;
    private TextView liveZapNumber;
    private TextView liveZapChannelName;
    private TextView liveZapQuality;
    private TextView liveZapNowTitle;
    private TextView liveZapDate;
    private TextView liveZapTimeRange;
    private TextView liveZapNextLabel;
    private TextView liveFsClock;
    private ProgressBar liveZapProgress;
    private final Map<Integer, LiveEpgInfo> liveEpgByChannel = new HashMap<>();
    private final Runnable hideLiveZapOsdRunnable = this::hideLiveZapOsd;
    private LiveCategoryAdapter liveCategoryAdapter;
    private LiveFsChannelAdapter liveFsChannelAdapter;
    private String liveActiveGroup;
    private int liveSelectedCategoryPos;
    private boolean liveCategoryPanelOpen;
    private boolean liveFsChannelPanelOpen;
    private ImageView liveOverlayLogo;
    private TextView liveProgramTitle;
    private TextView liveScrollUp;
    private TextView liveScrollDown;
    private FrameLayout livePlayerHost;
    private PlayerView livePlayerView;
    private ExoPlayer livePlayer;
    private final Runnable heroRotateRunnable = this::advanceHeroSlide;
    private ChannelAdapter channelAdapter;
    private CatalogAdapter catalogAdapter;
    private int currentSection = SEC_HOME;
    private int selectedChannelPos = -1;
    private boolean liveInlineFullscreen;
    private int lastWatchedLiveChannelId = -1;
    private boolean liveExplicitTune;
    private static final String CHANNEL_PAYLOAD_PLAYING = "playing";
    private String serverBase = "";
    private String authToken = "";
    private String lastCatalogType = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!NativeAuth.hasToken(this)) {
            startActivity(new Intent(this, TvLoginActivity.class));
            finish();
            return;
        }
        setContentView(R.layout.activity_tv_shell);
        serverBase = ServerUrlHelper.fromPrefs(getSharedPreferences(AppConstants.PREFS, MODE_PRIVATE));
        authToken = NativeAuth.getToken(this);

        navHome = findViewById(R.id.tv_nav_home);
        navLive = findViewById(R.id.tv_nav_live);
        navDestacados = findViewById(R.id.tv_nav_destacados);
        navMovies = findViewById(R.id.tv_nav_movies);
        navSeries = findViewById(R.id.tv_nav_series);
        navKids = findViewById(R.id.tv_nav_kids);
        navAnime = findViewById(R.id.tv_nav_anime);
        navExplore = findViewById(R.id.tv_nav_explore);
        clockView = findViewById(R.id.tv_clock);
        notifyBadge = findViewById(R.id.tv_notify_badge);

        panelLive = findViewById(R.id.panel_live);
        panelCatalog = findViewById(R.id.panel_catalog);
        bindPanelViews();

        setupTopBar();

        tvSidebar = findViewById(R.id.tv_sidebar);
        tvTopBar = findViewById(R.id.tv_top_bar);

        setupLivePanel();

        if (liveChannelsList != null) {
            liveChannelsList.setLayoutManager(new LinearLayoutManager(this));
            liveChannelsList.setItemAnimator(null);
            liveChannelsList.setHasFixedSize(true);
            channelAdapter = new ChannelAdapter();
            liveChannelsList.setAdapter(channelAdapter);
        }

        if (catalogList != null) {
            catalogList.setLayoutManager(new LinearLayoutManager(this));
            catalogAdapter = new CatalogAdapter();
            catalogList.setAdapter(catalogAdapter);
        }

        setupNavFocus();

        switchSection(SEC_HOME);
        handleLiveChannelIntent(getIntent());
        handler.postDelayed(() -> {
            if (!isFinishing()) navHome.requestFocus();
        }, 200);
        startClock();
        handler.postDelayed(() -> {
            if (!isFinishing()) UpdateChecker.checkAsync(TvShellActivity.this);
        }, 3000);
        UpdateChecker.handleUpdateIntent(this, getIntent());
    }

    /** IDs dentro de &lt;include&gt; no siempre están en la raíz de la Activity. */
    private void bindPanelViews() {
        if (panelLive != null) {
            liveRoot = panelLive.findViewById(R.id.tv_live_root);
            liveNowTitle = panelLive.findViewById(R.id.tv_live_now_title);
            liveChannelsList = panelLive.findViewById(R.id.tv_live_channels);
            liveEmpty = panelLive.findViewById(R.id.tv_live_empty);
            liveChannelDrawer = panelLive.findViewById(R.id.tv_live_channel_drawer);
            liveCategoryDrawer = panelLive.findViewById(R.id.tv_live_category_drawer);
            liveFsChannelDrawer = panelLive.findViewById(R.id.tv_live_fs_channel_drawer);
            liveCategoriesList = panelLive.findViewById(R.id.tv_live_categories);
            liveFsChannelsList = panelLive.findViewById(R.id.tv_live_fs_channels);
            liveOverlayHint = panelLive.findViewById(R.id.tv_live_overlay_hint);
            liveOverlayLogo = panelLive.findViewById(R.id.tv_live_overlay_logo);
            liveProgramTitle = panelLive.findViewById(R.id.tv_live_program_title);
            liveScrollUp = panelLive.findViewById(R.id.tv_live_scroll_up);
            liveScrollDown = panelLive.findViewById(R.id.tv_live_scroll_down);
            livePlayerHost = panelLive.findViewById(R.id.tv_live_player_host);
            livePlayerWrap = panelLive.findViewById(R.id.tv_live_player_wrap);
            liveBodyRow = panelLive.findViewById(R.id.tv_live_body_row);
            liveFullscreenBtn = panelLive.findViewById(R.id.tv_live_fullscreen_btn);
            liveZapOsd = panelLive.findViewById(R.id.tv_live_zap_osd);
            liveZapLogo = panelLive.findViewById(R.id.tv_zap_logo);
            liveZapNumber = panelLive.findViewById(R.id.tv_zap_number);
            liveZapChannelName = panelLive.findViewById(R.id.tv_zap_channel_name);
            liveZapQuality = panelLive.findViewById(R.id.tv_zap_quality);
            liveZapNowTitle = panelLive.findViewById(R.id.tv_zap_now_title);
            liveZapDate = panelLive.findViewById(R.id.tv_zap_date);
            liveZapTimeRange = panelLive.findViewById(R.id.tv_zap_time_range);
            liveZapNextLabel = panelLive.findViewById(R.id.tv_zap_next_label);
            liveFsClock = panelLive.findViewById(R.id.tv_live_fs_clock);
            liveZapProgress = panelLive.findViewById(R.id.tv_zap_progress);
        }
        if (panelCatalog != null) {
            catalogList = panelCatalog.findViewById(R.id.tv_catalog_list);
            if (catalogList != null) {
                catalogList.setClipChildren(false);
                catalogList.setClipToPadding(false);
            }
            catalogLoading = panelCatalog.findViewById(R.id.tv_catalog_loading);
            catalogEmpty = panelCatalog.findViewById(R.id.tv_catalog_empty);
        }
    }

    private void ensureLivePlayer() {
        if (livePlayer != null) return;
        if (livePlayerHost == null) return;
        try {
            livePlayerView = new PlayerView(this);
            livePlayerView.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
            livePlayerView.setUseController(false);
            livePlayerHost.addView(livePlayerView);
            livePlayer = new ExoPlayer.Builder(this).build();
            livePlayerView.setPlayer(livePlayer);
        } catch (Throwable e) {
            Toast.makeText(this, "Reproductor TV no disponible", Toast.LENGTH_LONG).show();
        }
    }

    private void setupTopBar() {
        View search = findViewById(R.id.tv_top_search);
        View filter = findViewById(R.id.tv_top_filter);
        View history = findViewById(R.id.tv_top_history);
        View profile = findViewById(R.id.tv_top_profile);
        View notify = findViewById(R.id.tv_top_notify);
        if (search != null) {
            search.setOnClickListener(v -> startActivity(new Intent(this, TvSearchActivity.class)));
            bindEnter(search, () -> startActivity(new Intent(this, TvSearchActivity.class)));
        }
        if (filter != null) {
            filter.setOnClickListener(v -> startActivity(new Intent(this, TvFunctionsActivity.class)));
            bindEnter(filter, () -> startActivity(new Intent(this, TvFunctionsActivity.class)));
        }
        if (history != null) {
            history.setOnClickListener(v -> startActivity(new Intent(this, TvHistoryActivity.class)));
            bindEnter(history, () -> startActivity(new Intent(this, TvHistoryActivity.class)));
        }
        if (profile != null) {
            profile.setOnClickListener(v -> startActivity(new Intent(this, TvAccountActivity.class)));
            bindEnter(profile, () -> startActivity(new Intent(this, TvAccountActivity.class)));
        }
        if (notify != null) {
            notify.setOnClickListener(v -> openContinueWatching());
            bindEnter(notify, this::openContinueWatching);
        }
        loadNotifyBadge();
    }

    private void openContinueWatching() {
        switchSection(SEC_HOME);
        refreshContinueRow(() -> {
            int rowIndex = findContinueRowIndex();
            if (rowIndex < 0) {
                Toast.makeText(this, "No hay contenido para continuar", Toast.LENGTH_SHORT).show();
                return;
            }
            int listPos = hasListHero() ? rowIndex + 1 : rowIndex;
            if (catalogList == null) return;
            catalogList.smoothScrollToPosition(listPos);
            catalogList.postDelayed(() -> focusContinueRowFirstItem(listPos), 300);
        });
    }

    private void focusContinueRowFirstItem(int listPos) {
        if (catalogList == null) return;
        RecyclerView.ViewHolder vh = catalogList.findViewHolderForAdapterPosition(listPos);
        if (vh == null) return;
        View rowItems = vh.itemView.findViewById(R.id.tv_row_items);
        if (rowItems instanceof RecyclerView) {
            RecyclerView rv = (RecyclerView) rowItems;
            if (rv.getChildCount() > 0) {
                rv.getChildAt(0).requestFocus();
            }
        }
    }

    private int findContinueRowIndex() {
        for (int i = 0; i < catalogRows.size(); i++) {
            if (catalogRows.get(i).continueRow) return i;
        }
        return -1;
    }

    private void refreshContinueRow(Runnable afterUi) {
        executor.execute(() -> {
            try {
                JSONArray cont = new VixApi(this).watchContinue();
                List<CatalogItem> contItems = new ArrayList<>();
                int contTotal = cont.length();
                int contMax = Math.min(ROW_PREVIEW_MAX, contTotal);
                for (int i = 0; i < contMax; i++) {
                    contItems.add(itemFromContinue(cont.getJSONObject(i)));
                }
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    int idx = findContinueRowIndex();
                    if (contItems.isEmpty()) {
                        if (idx >= 0) {
                            catalogRows.remove(idx);
                            if (catalogAdapter != null) catalogAdapter.notifyDataSetChanged();
                        }
                    } else {
                        CatalogRow row = new CatalogRow("Continuar viendo", contItems, false,
                            null, null, "mixed", contTotal, true);
                        if (idx >= 0) catalogRows.set(idx, row);
                        else catalogRows.add(0, row);
                        if (catalogAdapter != null) catalogAdapter.notifyDataSetChanged();
                    }
                    loadNotifyBadge();
                    if (afterUi != null) afterUi.run();
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (afterUi != null) afterUi.run();
                });
            }
        });
    }

    public void tuneLiveChannel(int channelId) {
        if (channelId <= 0) return;
        liveExplicitTune = true;
        lastWatchedLiveChannelId = channelId;
        switchSection(SEC_LIVE);
        handler.postDelayed(() -> playLiveChannelById(channelId), 150);
    }

    private void playLiveChannelById(int channelId) {
        int idx = findVisibleChannelIndex(channelId);
        if (idx < 0) {
            for (ChannelItem ch : channels) {
                if (ch.id == channelId) {
                    liveActiveGroup = null;
                    liveSelectedCategoryPos = 0;
                    rebuildVisibleChannels();
                    idx = findVisibleChannelIndex(channelId);
                    break;
                }
            }
        }
        if (idx >= 0) {
            playChannelPreview(visibleChannels.get(idx), idx);
            scrollLiveListToSelected(true);
        } else if (channels.isEmpty()) {
            loadLive();
        }
    }

    private static int continueProgressPercent(CatalogItem item) {
        if (item == null || item.duration <= 0 || item.progress <= 0) return 0;
        return (int) Math.min(100, (item.progress * 100) / item.duration);
    }

    private void loadNotifyBadge() {
        if (notifyBadge == null) return;
        executor.execute(() -> {
            try {
                int n = new VixApi(this).watchContinue().length();
                runOnUiThread(() -> {
                    if (n > 0) {
                        notifyBadge.setText(String.valueOf(Math.min(n, 9)));
                        notifyBadge.setVisibility(View.VISIBLE);
                    } else {
                        notifyBadge.setVisibility(View.GONE);
                    }
                });
            } catch (Exception ignored) {
                runOnUiThread(() -> notifyBadge.setVisibility(View.GONE));
            }
        });
    }

    private void startClock() {
        Runnable tick = new Runnable() {
            @Override
            public void run() {
                clockView.setText(new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date()));
                handler.postDelayed(this, 30000);
            }
        };
        tick.run();
    }

    private void setupNavFocus() {
        setupNavIcons();
        bindNavFocus(navHome, SEC_HOME);
        bindNavFocus(navLive, SEC_LIVE);
        bindNavFocus(navDestacados, SEC_DESTACADOS);
        bindNavFocus(navMovies, SEC_MOVIES);
        bindNavFocus(navSeries, SEC_SERIES);
        bindNavFocus(navKids, SEC_KIDS);
        bindNavFocus(navAnime, SEC_ANIME);
        bindNavFocus(navExplore, SEC_EXPLORE);
    }

    private void bindNavFocus(TextView nav, int section) {
        if (nav == null) return;
        nav.setOnFocusChangeListener((v, has) -> {
            if (has) {
                int accent = ContextCompat.getColor(this, R.color.tv_accent);
                nav.setTextColor(accent);
                tintNavIcon(nav, accent);
                if (currentSection != section) switchSection(section);
                else highlightNav(section);
            } else {
                highlightNav(currentSection);
            }
        });
        nav.setOnClickListener(v -> {
            if (currentSection != section) switchSection(section);
            else highlightNav(section);
        });
    }

    private boolean isNavFocused() {
        View f = getCurrentFocus();
        return f == navHome || f == navLive || f == navDestacados || f == navMovies
            || f == navSeries || f == navKids || f == navAnime || f == navExplore;
    }

    private void setupLivePanel() {
        if (liveCategoriesList != null) {
            liveCategoriesList.setLayoutManager(new LinearLayoutManager(this));
            liveCategoriesList.setItemAnimator(null);
            liveCategoryAdapter = new LiveCategoryAdapter();
            liveCategoriesList.setAdapter(liveCategoryAdapter);
        }
        if (liveFsChannelsList != null) {
            liveFsChannelsList.setLayoutManager(new LinearLayoutManager(this));
            liveFsChannelsList.setItemAnimator(null);
            liveFsChannelAdapter = new LiveFsChannelAdapter();
            liveFsChannelsList.setAdapter(liveFsChannelAdapter);
        }
        if (livePlayerWrap == null) return;
        livePlayerWrap.setOnFocusChangeListener((v, has) -> {
            if (liveFullscreenBtn != null && !liveInlineFullscreen) {
                liveFullscreenBtn.setVisibility(has ? View.VISIBLE : View.GONE);
            }
        });
        livePlayerWrap.setOnClickListener(v -> toggleLiveInlineFullscreen());
        bindEnter(livePlayerWrap, this::toggleLiveInlineFullscreen);
        if (liveFullscreenBtn != null) {
            liveFullscreenBtn.setFocusable(true);
            liveFullscreenBtn.setOnClickListener(v -> toggleLiveInlineFullscreen());
            bindEnter(liveFullscreenBtn, this::toggleLiveInlineFullscreen);
        }
        if (liveScrollUp != null && liveChannelsList != null) {
            liveScrollUp.setOnClickListener(v -> scrollLiveChannels(-1));
            bindEnter(liveScrollUp, () -> scrollLiveChannels(-1));
        }
        if (liveScrollDown != null && liveChannelsList != null) {
            liveScrollDown.setOnClickListener(v -> scrollLiveChannels(1));
            bindEnter(liveScrollDown, () -> scrollLiveChannels(1));
        }
        updateLiveFocusChain();
    }

    private void scrollLiveChannels(int delta) {
        if (liveChannelsList == null || visibleChannels.isEmpty()) return;
        int pos = selectedChannelPos >= 0 ? selectedChannelPos : 0;
        int next = Math.max(0, Math.min(visibleChannels.size() - 1, pos + delta));
        if (next == pos) return;
        playChannelPreview(visibleChannels.get(next), next);
        liveChannelsList.smoothScrollToPosition(next);
        focusLiveChannelAt(next);
    }

    private void focusLiveChannelAt(int pos) {
        if (liveChannelsList == null) return;
        liveChannelsList.post(() -> {
            RecyclerView.ViewHolder h = liveChannelsList.findViewHolderForAdapterPosition(pos);
            View target = h != null ? h.itemView.findViewById(R.id.tv_ch_inner) : null;
            if (target != null) target.requestFocus();
        });
    }

    private int findChannelIndex(int channelId) {
        for (int i = 0; i < channels.size(); i++) {
            if (channels.get(i).id == channelId) return i;
        }
        return -1;
    }

    /** Centra la lista en el canal en reproducción (no vuelve al inicio / Ecuador). */
    private void scrollLiveListToSelected(boolean focusPreview) {
        int pos = selectedChannelPos;
        if (pos < 0 && lastWatchedLiveChannelId > 0) {
            pos = findVisibleChannelIndex(lastWatchedLiveChannelId);
            if (pos >= 0) selectedChannelPos = pos;
        }
        if (pos < 0 || liveChannelsList == null || visibleChannels.isEmpty()) {
            if (focusPreview && livePlayerWrap != null) livePlayerWrap.requestFocus();
            return;
        }
        if (channelAdapter != null) channelAdapter.notifyDataSetChanged();
        liveChannelsList.scrollToPosition(pos);
        final int scrollPos = pos;
        liveChannelsList.post(() -> {
            RecyclerView.ViewHolder h = liveChannelsList.findViewHolderForAdapterPosition(scrollPos);
            if (h != null && h.itemView != null) {
                h.itemView.requestRectangleOnScreen(
                    new android.graphics.Rect(0, 0, h.itemView.getWidth(), h.itemView.getHeight()),
                    false
                );
            }
            if (focusPreview && livePlayerWrap != null) {
                livePlayerWrap.requestFocus();
            } else {
                focusLiveChannelAt(scrollPos);
            }
        });
    }

    private void muteLivePreview() {
        if (livePlayer != null) livePlayer.setVolume(0f);
    }

    private void unmuteLivePreview() {
        if (livePlayer != null) {
            livePlayer.setVolume(1f);
            livePlayer.setPlayWhenReady(true);
        }
    }

    private void updateLiveNowPlaying(ChannelItem ch) {
        if (ch == null) return;
        if (liveNowTitle != null) liveNowTitle.setText(ch.name);
        if (liveProgramTitle != null) liveProgramTitle.setText(ch.name);
        if (liveOverlayLogo != null) {
            String url = PlayUrls.poster(serverBase, ch.logo);
            if (url.isEmpty()) {
                liveOverlayLogo.setVisibility(View.GONE);
            } else {
                liveOverlayLogo.setVisibility(View.VISIBLE);
                loadPoster(liveOverlayLogo, ch.logo);
            }
        }
    }

    private void updateLiveFocusChain() {
        if (navLive == null || livePlayerWrap == null) return;
        navLive.setNextFocusRightId(livePlayerWrap.getId());
        livePlayerWrap.setNextFocusLeftId(navLive.getId());
        if (liveChannelsList == null || visibleChannels.isEmpty()) {
            livePlayerWrap.setNextFocusRightId(navLive.getId());
            return;
        }
        livePlayerWrap.setNextFocusRightId(liveChannelsList.getId());
        liveChannelsList.setNextFocusLeftId(livePlayerWrap.getId());
    }

    private void syncLiveFullscreenUi() {
        if (liveFullscreenBtn == null) return;
        liveFullscreenBtn.setText(liveInlineFullscreen ? "🗗" : "⛶");
        liveFullscreenBtn.setVisibility(
            liveInlineFullscreen || (livePlayerWrap != null && livePlayerWrap.isFocused())
                ? View.VISIBLE : View.GONE);
    }

    private void enterLiveInlineFullscreen() {
        if (liveInlineFullscreen) return;
        ChannelItem ch = getSelectedChannel();
        if (ch == null) {
            Toast.makeText(this, "Selecciona un canal", Toast.LENGTH_SHORT).show();
            return;
        }
        if (livePlayer == null) {
            playChannelPreview(ch, selectedChannelPos >= 0 ? selectedChannelPos : 0);
        }
        liveInlineFullscreen = true;
        if (liveRoot != null) liveRoot.setBackgroundColor(0xFF000000);
        if (tvSidebar != null) tvSidebar.setVisibility(View.GONE);
        if (tvTopBar != null) tvTopBar.setVisibility(View.GONE);
        if (liveChannelDrawer != null) liveChannelDrawer.setVisibility(View.GONE);
        closeLivePanels();
        setLivePreviewChromeVisible(false);
        if (liveBodyRow != null) liveBodyRow.setPadding(0, 0, 0, 0);
        if (livePlayerWrap != null) {
            LinearLayout.LayoutParams lp = (LinearLayout.LayoutParams) livePlayerWrap.getLayoutParams();
            lp.width = LinearLayout.LayoutParams.MATCH_PARENT;
            lp.height = LinearLayout.LayoutParams.MATCH_PARENT;
            lp.weight = 0f;
            lp.setMarginEnd(0);
            livePlayerWrap.setLayoutParams(lp);
            livePlayerWrap.requestFocus();
        }
        unmuteLivePreview();
        syncLiveFullscreenUi();
        showLiveZapOsd(getSelectedChannel());
    }

    private void exitLiveInlineFullscreen() {
        if (!liveInlineFullscreen) return;
        hideLiveZapOsd();
        liveInlineFullscreen = false;
        if (liveRoot != null) liveRoot.setBackgroundResource(R.drawable.tv_live_bg);
        if (tvSidebar != null) tvSidebar.setVisibility(View.VISIBLE);
        if (tvTopBar != null) tvTopBar.setVisibility(View.VISIBLE);
        closeLivePanels();
        hideLiveZapOsd();
        setLivePreviewChromeVisible(true);
        if (liveChannelDrawer != null) liveChannelDrawer.setVisibility(View.VISIBLE);
        if (liveBodyRow != null) {
            int pad = (int) (24 * getResources().getDisplayMetrics().density);
            int padTop = (int) (20 * getResources().getDisplayMetrics().density);
            liveBodyRow.setPadding(pad, padTop, pad, pad);
        }
        if (livePlayerWrap != null) {
            LinearLayout.LayoutParams lp = (LinearLayout.LayoutParams) livePlayerWrap.getLayoutParams();
            lp.width = 0;
            lp.height = LinearLayout.LayoutParams.MATCH_PARENT;
            lp.weight = 1f;
            lp.setMarginEnd((int) (24 * getResources().getDisplayMetrics().density));
            livePlayerWrap.setLayoutParams(lp);
            livePlayerWrap.requestFocus();
        }
        syncLiveFullscreenUi();
    }

    private void toggleLiveInlineFullscreen() {
        if (liveInlineFullscreen) exitLiveInlineFullscreen();
        else enterLiveInlineFullscreen();
    }

    private void buildLiveCategories() {
        liveCategoryNames.clear();
        liveCategoryNames.add(GROUP_ALL);
        Set<String> groups = new LinkedHashSet<>();
        for (ChannelItem ch : channels) {
            if (ch.group != null && !ch.group.isEmpty()) groups.add(ch.group);
        }
        List<String> sorted = new ArrayList<>(groups);
        Collections.sort(sorted, String::compareToIgnoreCase);
        liveCategoryNames.addAll(sorted);
        if (liveCategoryAdapter != null) liveCategoryAdapter.notifyDataSetChanged();
    }

    private void rebuildVisibleChannels() {
        int currentId = getSelectedChannelId();
        visibleChannels.clear();
        for (ChannelItem ch : channels) {
            if (liveActiveGroup == null || liveActiveGroup.isEmpty() || liveActiveGroup.equals(ch.group)) {
                visibleChannels.add(ch);
            }
        }
        selectedChannelPos = findVisibleChannelIndex(currentId);
        if (channelAdapter != null) channelAdapter.notifyDataSetChanged();
        if (liveFsChannelAdapter != null) liveFsChannelAdapter.notifyDataSetChanged();
        updateLiveFocusChain();
    }

    private int getSelectedChannelId() {
        if (selectedChannelPos >= 0 && selectedChannelPos < visibleChannels.size()) {
            return visibleChannels.get(selectedChannelPos).id;
        }
        return lastWatchedLiveChannelId > 0 ? lastWatchedLiveChannelId : -1;
    }

    private int findVisibleChannelIndex(int channelId) {
        if (channelId <= 0) return visibleChannels.isEmpty() ? -1 : 0;
        for (int i = 0; i < visibleChannels.size(); i++) {
            if (visibleChannels.get(i).id == channelId) return i;
        }
        return visibleChannels.isEmpty() ? -1 : 0;
    }

    private boolean shouldHandleLiveCategoryKey() {
        if (liveInlineFullscreen || liveCategoryPanelOpen || liveFsChannelPanelOpen) return true;
        View focus = getCurrentFocus();
        return livePlayerWrap != null && focus != null
            && (focus == livePlayerWrap || isDescendantOf(livePlayerWrap, focus));
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

    private void closeLivePanels() {
        liveCategoryPanelOpen = false;
        liveFsChannelPanelOpen = false;
        if (liveCategoryDrawer != null) liveCategoryDrawer.setVisibility(View.GONE);
        if (liveFsChannelDrawer != null) liveFsChannelDrawer.setVisibility(View.GONE);
    }

    private void showLiveOverlayHint() {
        if (liveOverlayHint == null) return;
        liveOverlayHint.setVisibility(View.VISIBLE);
        handler.removeCallbacks(hideLiveHintRunnable);
        handler.postDelayed(hideLiveHintRunnable, 5000);
    }

    private void hideLiveOverlayHint() {
        if (liveOverlayHint == null) return;
        handler.removeCallbacks(hideLiveHintRunnable);
        liveOverlayHint.setVisibility(View.GONE);
    }

    private void setLivePreviewChromeVisible(boolean visible) {
        int vis = visible ? View.VISIBLE : View.GONE;
        View bottomBar = panelLive != null ? panelLive.findViewById(R.id.tv_live_bottom_bar) : null;
        if (bottomBar != null) bottomBar.setVisibility(vis);
        if (liveProgramTitle != null && liveProgramTitle.getParent() instanceof View) {
            ((View) liveProgramTitle.getParent()).setVisibility(vis);
        }
        if (liveOverlayLogo != null && !visible) liveOverlayLogo.setVisibility(View.GONE);
    }

    private final Runnable hideLiveHintRunnable = this::hideLiveOverlayHint;

    private void toggleLiveCategoryPanel() {
        if (liveCategoryNames.isEmpty()) return;
        if (liveCategoryPanelOpen) {
            closeLivePanels();
            if (livePlayerWrap != null) livePlayerWrap.requestFocus();
            return;
        }
        liveFsChannelPanelOpen = false;
        if (liveFsChannelDrawer != null) liveFsChannelDrawer.setVisibility(View.GONE);
        liveCategoryPanelOpen = true;
        if (liveCategoryDrawer != null) liveCategoryDrawer.setVisibility(View.VISIBLE);
        focusLiveCategory(liveSelectedCategoryPos);
    }

    private void openLiveChannelPanel() {
        if (visibleChannels.isEmpty()) return;
        liveFsChannelPanelOpen = true;
        if (liveFsChannelDrawer != null) liveFsChannelDrawer.setVisibility(View.VISIBLE);
        focusLiveFsChannelAtCurrent();
    }

    private void closeLiveChannelPanelOnly() {
        liveFsChannelPanelOpen = false;
        if (liveFsChannelDrawer != null) liveFsChannelDrawer.setVisibility(View.GONE);
    }

    private void openLiveChannelPanelForCategory(int pos) {
        if (pos < 0 || pos >= liveCategoryNames.size()) return;
        liveSelectedCategoryPos = pos;
        String name = liveCategoryNames.get(pos);
        liveActiveGroup = GROUP_ALL.equals(name) ? null : name;
        rebuildVisibleChannels();
        if (liveCategoryAdapter != null) liveCategoryAdapter.notifyDataSetChanged();
        liveCategoryPanelOpen = true;
        if (liveCategoryDrawer != null) liveCategoryDrawer.setVisibility(View.VISIBLE);
        openLiveChannelPanel();
    }

    private void selectLiveCategory(int pos) {
        openLiveChannelPanelForCategory(pos);
    }

    private boolean isFocusInLiveFsChannelPanel() {
        View focus = getCurrentFocus();
        return liveFsChannelDrawer != null && focus != null
            && (focus == liveFsChannelDrawer || isDescendantOf(liveFsChannelDrawer, focus));
    }

    private boolean isFocusInLiveCategoryPanel() {
        View focus = getCurrentFocus();
        return liveCategoryDrawer != null && focus != null
            && (focus == liveCategoryDrawer || isDescendantOf(liveCategoryDrawer, focus));
    }

    private void focusLiveCategory(int pos) {
        if (liveCategoriesList == null) return;
        liveCategoriesList.post(() -> {
            RecyclerView.ViewHolder h = liveCategoriesList.findViewHolderForAdapterPosition(pos);
            View target = h != null ? h.itemView.findViewById(R.id.tv_grp_inner) : null;
            if (target != null) target.requestFocus();
            else liveCategoriesList.requestFocus();
        });
    }

    private void focusLiveFsChannelAtCurrent() {
        if (liveFsChannelsList == null) return;
        int pos = Math.max(0, selectedChannelPos);
        liveFsChannelsList.post(() -> {
            RecyclerView.ViewHolder h = liveFsChannelsList.findViewHolderForAdapterPosition(pos);
            View target = h != null ? h.itemView.findViewById(R.id.tv_ch_inner) : null;
            if (target != null) target.requestFocus();
            else liveFsChannelsList.requestFocus();
        });
    }

    private void focusLiveChannelList() {
        if (liveChannelsList == null || visibleChannels.isEmpty()) return;
        int pos = selectedChannelPos >= 0 ? selectedChannelPos : 0;
        liveChannelsList.post(() -> {
            RecyclerView.ViewHolder h = liveChannelsList.findViewHolderForAdapterPosition(pos);
            View target = null;
            if (h != null) target = h.itemView.findViewById(R.id.tv_ch_inner);
            if (target != null) target.requestFocus();
            else liveChannelsList.requestFocus();
        });
    }

    private ChannelItem getSelectedChannel() {
        if (selectedChannelPos >= 0 && selectedChannelPos < visibleChannels.size()) {
            return visibleChannels.get(selectedChannelPos);
        }
        return visibleChannels.isEmpty() ? null : visibleChannels.get(0);
    }

    private void switchSection(int section) {
        if (section != SEC_LIVE) {
            closeLivePanels();
            hideLiveOverlayHint();
            exitLiveInlineFullscreen();
        }
        currentSection = section;
        highlightNav(section);
        stopHeroRotation();
        if (section == SEC_LIVE) {
            panelLive.setVisibility(View.VISIBLE);
            panelCatalog.setVisibility(View.GONE);
            updateLiveFocusChain();
            if (channels.isEmpty()) {
                loadLive();
            } else {
                handler.post(() -> {
                    if (currentSection != SEC_LIVE || isFinishing()) return;
                    playLiveOnOpen();
                    scrollLiveListToSelected(!isNavFocused());
                });
            }
        } else {
            panelLive.setVisibility(View.GONE);
            panelCatalog.setVisibility(View.VISIBLE);
            releasePlayer();
            heroInCatalogList = true;
            String slug = catalogSlugForSection(section);
            int navFocusId = navIdForSection(section);
            if (catalogList != null) {
                catalogList.setVisibility(View.VISIBLE);
                catalogList.setNextFocusLeftId(navFocusId);
            }
            if (section == SEC_HOME) {
                if (!"home".equals(lastCatalogType)) loadHome();
                else {
                    catalogAdapter.notifyDataSetChanged();
                    startHeroRotation();
                }
            } else if (!slug.equals(lastCatalogType)) {
                catalogRows.clear();
                catalogAdapter.notifyDataSetChanged();
                loadStorefront(slug);
            } else if (hasListHero()) {
                catalogAdapter.notifyDataSetChanged();
                startHeroRotation();
            }
        }
    }

    private void setupNavIcons() {
        bindNavIcon(navHome, R.drawable.ic_nav_home);
        bindNavIcon(navLive, R.drawable.ic_nav_tv);
        bindNavIcon(navDestacados, R.drawable.ic_nav_destacados);
        bindNavIcon(navMovies, R.drawable.ic_nav_movie);
        bindNavIcon(navSeries, R.drawable.ic_nav_series);
        bindNavIcon(navKids, R.drawable.ic_nav_kids);
        bindNavIcon(navAnime, R.drawable.ic_nav_anime);
        bindNavIcon(navExplore, R.drawable.ic_nav_explore);
        highlightNav(currentSection);
    }

    private String catalogSlugForSection(int section) {
        if (section == SEC_DESTACADOS) return "destacados";
        if (section == SEC_MOVIES) return "movies";
        if (section == SEC_SERIES) return "series";
        if (section == SEC_KIDS) return "kids";
        if (section == SEC_ANIME) return "anime";
        if (section == SEC_EXPLORE) return "explorar";
        return "home";
    }

    private int navIdForSection(int section) {
        if (section == SEC_LIVE) return R.id.tv_nav_live;
        if (section == SEC_DESTACADOS) return R.id.tv_nav_destacados;
        if (section == SEC_MOVIES) return R.id.tv_nav_movies;
        if (section == SEC_SERIES) return R.id.tv_nav_series;
        if (section == SEC_KIDS) return R.id.tv_nav_kids;
        if (section == SEC_ANIME) return R.id.tv_nav_anime;
        if (section == SEC_EXPLORE) return R.id.tv_nav_explore;
        return R.id.tv_nav_home;
    }

    private void bindNavIcon(TextView tv, int iconRes) {
        if (tv == null) return;
        Drawable icon = ContextCompat.getDrawable(this, iconRes);
        if (icon == null) return;
        icon = icon.mutate();
        int size = (int) (22 * getResources().getDisplayMetrics().density);
        icon.setBounds(0, 0, size, size);
        tv.setCompoundDrawables(icon, null, null, null);
    }

    private void tintNavIcon(TextView tv, int color) {
        if (tv == null) return;
        Drawable[] ds = tv.getCompoundDrawables();
        if (ds[0] == null) return;
        Drawable icon = ds[0].mutate();
        icon.setTint(color);
        tv.setCompoundDrawables(icon, null, null, null);
    }

    private void highlightNav(int section) {
        TextView[] all = { navHome, navLive, navDestacados, navMovies, navSeries, navKids, navAnime, navExplore };
        int dim = ContextCompat.getColor(this, R.color.tv_text_dim);
        for (TextView t : all) {
            if (t == null) continue;
            t.setSelected(false);
            t.setTextColor(dim);
            tintNavIcon(t, dim);
        }
        TextView active = navHome;
        if (section == SEC_LIVE) active = navLive;
        else if (section == SEC_DESTACADOS) active = navDestacados;
        else if (section == SEC_MOVIES) active = navMovies;
        else if (section == SEC_SERIES) active = navSeries;
        else if (section == SEC_KIDS) active = navKids;
        else if (section == SEC_ANIME) active = navAnime;
        else if (section == SEC_EXPLORE) active = navExplore;
        active.setSelected(true);
        int accent = ContextCompat.getColor(this, R.color.tv_accent);
        active.setTextColor(accent);
        tintNavIcon(active, accent);
    }

    private void playLiveOnOpen() {
        if (liveExplicitTune) {
            liveExplicitTune = false;
            if (lastWatchedLiveChannelId > 0) {
                int pos = findVisibleChannelIndex(lastWatchedLiveChannelId);
                if (pos >= 0) {
                    playChannelPreview(visibleChannels.get(pos), pos);
                    return;
                }
            }
        }
        playRandomLiveChannel();
    }

    private void playRandomLiveChannel() {
        if (visibleChannels.isEmpty()) return;
        int pos = pickRandomLiveChannelPos(visibleChannels);
        playChannelPreview(visibleChannels.get(pos), pos);
    }

    private int pickRandomLiveChannelPos(List<ChannelItem> list) {
        if (list == null || list.isEmpty()) return 0;
        List<Integer> pool = new ArrayList<>();
        for (int i = 0; i < list.size(); i++) {
            if (!isSportsChannel(list.get(i))) pool.add(i);
        }
        if (pool.isEmpty()) {
            return new Random().nextInt(list.size());
        }
        return pool.get(new Random().nextInt(pool.size()));
    }

    private static boolean isSportsChannel(ChannelItem ch) {
        if (ch == null || ch.group == null) return false;
        String g = ch.group.toLowerCase(Locale.ROOT);
        return g.contains("deporte") || g.contains("sport");
    }

    private void loadLiveEpgAsync() {
        executor.execute(() -> {
            try {
                JSONObject root = new VixApi(this).liveEpg();
                JSONObject epg = root.optJSONObject("epg");
                Map<Integer, LiveEpgInfo> map = new HashMap<>();
                if (epg != null) {
                    Iterator<String> keys = epg.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        JSONObject entry = epg.optJSONObject(key);
                        if (entry == null) continue;
                        try {
                            int id = Integer.parseInt(key);
                            map.put(id, LiveEpgInfo.fromJson(entry));
                        } catch (NumberFormatException ignored) { /* */ }
                    }
                }
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    liveEpgByChannel.clear();
                    liveEpgByChannel.putAll(map);
                    if (liveInlineFullscreen && liveZapOsd != null && liveZapOsd.getVisibility() == View.VISIBLE) {
                        showLiveZapOsd(getSelectedChannel());
                    }
                });
            } catch (Exception ignored) { /* EPG opcional */ }
        });
    }

    private void zapLiveChannel(int delta) {
        if (!liveInlineFullscreen || visibleChannels.isEmpty()) return;
        if (liveCategoryPanelOpen || liveFsChannelPanelOpen) return;
        int pos = selectedChannelPos >= 0 ? selectedChannelPos : 0;
        int next = (pos + delta + visibleChannels.size()) % visibleChannels.size();
        if (next == pos) return;
        ChannelItem ch = visibleChannels.get(next);
        playChannelPreview(ch, next);
        showLiveZapOsd(ch);
    }

    private void showLiveZapOsd(ChannelItem ch) {
        if (!liveInlineFullscreen || ch == null || liveZapOsd == null) return;
        LiveEpgInfo epg = liveEpgByChannel.get(ch.id);
        if (epg == null) epg = LiveEpgInfo.fallback(ch);

        if (liveZapNumber != null) liveZapNumber.setText(String.valueOf(nextChannelDisplayNumber(ch)));
        if (liveZapChannelName != null) liveZapChannelName.setText(ch.name);
        if (liveZapQuality != null) liveZapQuality.setText(detectChannelQuality(ch.name));
        if (liveZapNowTitle != null) liveZapNowTitle.setText(epg.nowTitle);
        if (liveZapTimeRange != null) liveZapTimeRange.setText(epg.nowRange);
        if (liveZapDate != null) {
            liveZapDate.setText(new SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(new Date()));
        }
        if (liveZapProgress != null) liveZapProgress.setProgress(Math.max(0, Math.min(100, epg.progress)));
        if (liveZapNextLabel != null) {
            String next = epg.nextTitle != null && !epg.nextTitle.isEmpty()
                ? "Próximo: " + epg.nextTitle + (epg.nextRange.isEmpty() ? "" : " · " + epg.nextRange)
                : "Próximo: —";
            liveZapNextLabel.setText(next);
        }
        if (liveZapLogo != null) loadPoster(liveZapLogo, ch.logo);
        if (liveFsClock != null) {
            liveFsClock.setText(new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date()));
        }
        hideLiveOverlayHint();
        liveZapOsd.setVisibility(View.VISIBLE);
        handler.removeCallbacks(hideLiveZapOsdRunnable);
        handler.postDelayed(hideLiveZapOsdRunnable, LIVE_ZAP_OSD_MS);
    }

    private void hideLiveZapOsd() {
        handler.removeCallbacks(hideLiveZapOsdRunnable);
        if (liveZapOsd != null) liveZapOsd.setVisibility(View.GONE);
    }

    private int nextChannelDisplayNumber(ChannelItem ch) {
        int idx = findVisibleChannelIndex(ch.id);
        if (idx >= 0) return idx + 1;
        for (int i = 0; i < channels.size(); i++) {
            if (channels.get(i).id == ch.id) return i + 1;
        }
        return 1;
    }

    private static String detectChannelQuality(String name) {
        if (name == null) return "HD";
        String u = name.toUpperCase(Locale.ROOT);
        if (u.contains("4K") || u.contains("UHD")) return "4K";
        if (u.contains("FHD")) return "FHD";
        if (u.contains("HD")) return "HD";
        return "HD";
    }

    private static boolean isLiveZapKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_DPAD_UP
            || keyCode == KeyEvent.KEYCODE_DPAD_DOWN
            || keyCode == KeyEvent.KEYCODE_CHANNEL_UP
            || keyCode == KeyEvent.KEYCODE_CHANNEL_DOWN
            || keyCode == KeyEvent.KEYCODE_PAGE_UP
            || keyCode == KeyEvent.KEYCODE_PAGE_DOWN;
    }

    private static int liveZapDelta(int keyCode) {
        if (keyCode == KeyEvent.KEYCODE_DPAD_UP
            || keyCode == KeyEvent.KEYCODE_CHANNEL_UP
            || keyCode == KeyEvent.KEYCODE_PAGE_UP) {
            return -1;
        }
        return 1;
    }

    private void loadLive() {
        loadLiveEpgAsync();
        executor.execute(() -> {
            try {
                JSONArray arr = new VixApi(this).liveChannels(null);
                List<ChannelItem> list = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject ch = arr.getJSONObject(i);
                    list.add(new ChannelItem(
                        ch.optInt("id", 0),
                        ch.optString("name", ""),
                        ch.optString("logo", ""),
                        ch.optString("group_title", "")
                    ));
                }
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    channels.clear();
                    channels.addAll(list);
                    liveSelectedCategoryPos = 0;
                    liveActiveGroup = null;
                    buildLiveCategories();
                    rebuildVisibleChannels();
                    if (channelAdapter != null) channelAdapter.notifyDataSetChanged();
                    if (liveEmpty != null) {
                        liveEmpty.setVisibility(list.isEmpty() ? View.VISIBLE : View.GONE);
                    }
                    if (!list.isEmpty()) {
                        playLiveOnOpen();
                    }
                    if (currentSection == SEC_LIVE && !list.isEmpty()) {
                        scrollLiveListToSelected(!isNavFocused());
                    }
                });
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show());
            }
        });
    }

    private void loadHome() {
        lastCatalogType = "home";
        loadCatalogStart();
        executor.execute(() -> {
            try {
                VixApi api = new VixApi(this);
                List<CatalogItem> allHero = new ArrayList<>();
                JSONArray hero = api.moviesHero();
                for (int i = 0; i < hero.length(); i++) {
                    allHero.add(itemFromMovie(hero.getJSONObject(i)));
                }
                CatalogItem fixed = allHero.isEmpty() ? null : allHero.get(0);
                List<CatalogItem> rotating = new ArrayList<>();
                for (int i = 1; i < allHero.size(); i++) rotating.add(allHero.get(i));
                if (rotating.isEmpty() && fixed != null) rotating.add(fixed);
                CatalogItem[] tiles = new CatalogItem[4];
                try {
                    JSONArray recent = api.moviesRecent();
                    for (int i = 0; i < Math.min(4, recent.length()); i++) {
                        tiles[i] = itemFromMovie(recent.getJSONObject(i));
                    }
                } catch (Exception ignored) { /* sin recientes */ }
                for (int i = 0; i < 4 && tiles[i] == null; i++) {
                    int src = i + 1;
                    if (src < allHero.size()) tiles[i] = allHero.get(src);
                }
                List<CatalogRow> rows = new ArrayList<>();
                try {
                    JSONArray cont = api.watchContinue();
                    if (cont.length() > 0) {
                        List<CatalogItem> contItems = new ArrayList<>();
                        int contTotal = cont.length();
                        int contMax = Math.min(ROW_PREVIEW_MAX, contTotal);
                        for (int i = 0; i < contMax; i++) {
                            contItems.add(itemFromContinue(cont.getJSONObject(i)));
                        }
                        rows.add(new CatalogRow("Continuar viendo", contItems, false,
                            null, null, "mixed", contTotal, true));
                    }
                } catch (Exception ignored) { /* sin perfil */ }
                JSONObject home = api.catalogHome();
                JSONArray sections = home.optJSONArray("sections");
                if (sections != null) {
                    for (int i = 0; i < sections.length(); i++) {
                        JSONObject sec = sections.getJSONObject(i);
                        JSONArray items = sec.optJSONArray("items");
                        if (items == null || items.length() == 0) continue;
                        int total = sec.optInt("total", items.length());
                        int max = Math.min(ROW_PREVIEW_MAX, items.length());
                        List<CatalogItem> list = new ArrayList<>();
                        for (int j = 0; j < max; j++) {
                            JSONObject it = items.getJSONObject(j);
                            String type = it.optString("content_type", sec.optString("type", "movie"));
                            if ("series".equals(type)) list.add(itemFromSeries(it));
                            else list.add(itemFromMovie(it));
                        }
                        rows.add(new CatalogRow(
                            sec.optString("title", ""),
                            list,
                            false,
                            sec.optString("id", ""),
                            sec.optString("genre", ""),
                            sec.optString("type", "movie"),
                            total
                        ));
                    }
                }
                publishHome(rotating, fixed, tiles, rows);
            } catch (Exception e) {
                publishCatalogError(e);
            }
        });
    }

    private void publishHome(List<CatalogItem> rotating, CatalogItem fixed, CatalogItem[] tiles, List<CatalogRow> rows) {
        runOnUiThread(() -> {
            if (catalogLoading != null) catalogLoading.setVisibility(View.GONE);
            heroRotating.clear();
            heroRotating.addAll(rotating);
            heroFixedItem = fixed;
            heroRotateIndex = 0;
            for (int i = 0; i < 4; i++) heroBottomTiles[i] = tiles[i];
            bindHomeHero();
            catalogRows.clear();
            catalogRows.addAll(rows);
            if (catalogAdapter != null) catalogAdapter.notifyDataSetChanged();
            boolean empty = rotating.isEmpty() && fixed == null && rows.isEmpty();
            if (catalogEmpty != null) catalogEmpty.setVisibility(empty ? View.VISIBLE : View.GONE);
            startHeroRotation();
        });
    }

    private void bindHomeHero() {
        if (heroFixedImg != null && heroFixedItem != null) {
            loadHeroImage(heroFixedImg, heroFixedItem);
        }
        for (int i = 0; i < 4; i++) {
            if (heroTileImgs[i] == null) continue;
            CatalogItem t = heroBottomTiles[i];
            if (t != null) {
                loadHeroImage(heroTileImgs[i], t);
            } else {
                heroTileImgs[i].setImageDrawable(null);
            }
        }
        showHeroSlideAt(heroRotateIndex, false);
    }

    private String heroImg(CatalogItem item) {
        if (item == null) return "";
        if (item.banner != null && !item.banner.isEmpty()) return item.banner;
        if (item.backdrop != null && !item.backdrop.isEmpty()) return item.backdrop;
        return item.poster;
    }

    private String heroBannerFromJson(JSONObject o, boolean isSeries) {
        return o.optString("banner", "");
    }

    private void showHeroSlideAt(int index, boolean animate) {
        if (heroSlideImg == null || heroRotating.isEmpty()) {
            if (heroSlideImg != null) heroSlideImg.setImageDrawable(null);
            if (heroSlideTitle != null) heroSlideTitle.setText("");
            rebuildHeroDots(0, 0);
            return;
        }
        int i = index % heroRotating.size();
        heroRotateIndex = i;
        CatalogItem item = heroRotating.get(i);
        Runnable apply = () -> {
            loadHeroImage(heroSlideImg, item);
            rebuildHeroDots(heroRotating.size(), i);
            if (animate) heroSlideImg.setAlpha(1f);
        };
        if (animate && heroSlideImg.getDrawable() != null) {
            if (heroSlideWrap != null) {
                heroSlideWrap.animate().scaleX(0.97f).scaleY(0.97f).setDuration(160).start();
            }
            heroSlideImg.animate().alpha(0f).setDuration(220).withEndAction(() -> {
                apply.run();
                heroSlideImg.animate().alpha(1f).setDuration(280).start();
                if (heroSlideWrap != null) {
                    heroSlideWrap.animate().scaleX(1f).scaleY(1f).setDuration(260).start();
                }
            }).start();
        } else {
            heroSlideImg.setAlpha(1f);
            if (heroSlideWrap != null) {
                heroSlideWrap.setScaleX(1f);
                heroSlideWrap.setScaleY(1f);
            }
            apply.run();
        }
    }

    private void rebuildHeroDots(int count, int active) {
        if (heroDots == null) return;
        heroDots.removeAllViews();
        if (count <= 1) return;
        int size = (int) (7 * getResources().getDisplayMetrics().density);
        int gap = (int) (5 * getResources().getDisplayMetrics().density);
        for (int d = 0; d < count; d++) {
            View dot = new View(this);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(size, size);
            if (d > 0) lp.setMarginStart(gap);
            dot.setLayoutParams(lp);
            dot.setBackgroundResource(d == active ? R.drawable.tv_dot_active : R.drawable.tv_dot_inactive);
            heroDots.addView(dot);
        }
    }

    private void advanceHeroSlide() {
        if (heroRotating.isEmpty()) return;
        showHeroSlideAt(heroRotateIndex + 1, true);
        startHeroRotation();
    }

    private void startHeroRotation() {
        stopHeroRotation();
        boolean catalogHero = currentSection == SEC_HOME || currentSection == SEC_MOVIES;
        if (!catalogHero || !heroInCatalogList || heroRotating.size() < 2) return;
        handler.postDelayed(heroRotateRunnable, HERO_ROTATE_MS);
    }

    private boolean hasListHero() {
        return heroInCatalogList
            && (heroFixedItem != null || !heroRotating.isEmpty()
            || heroBottomTiles[0] != null);
    }

    private void bindHeroFromView(View root) {
        if (root == null) return;
        heroSlideImg = root.findViewById(R.id.tv_hero_slide_img);
        heroSlideTitle = root.findViewById(R.id.tv_hero_slide_title);
        heroFixedImg = root.findViewById(R.id.tv_hero_fixed_img);
        heroDots = root.findViewById(R.id.tv_hero_dots);
        heroSlideWrap = root.findViewById(R.id.tv_hero_slide_wrap);
        heroFixedWrap = root.findViewById(R.id.tv_hero_fixed_wrap);
        int[] tileIds = { R.id.tv_hero_tile_0, R.id.tv_hero_tile_1, R.id.tv_hero_tile_2, R.id.tv_hero_tile_3 };
        for (int i = 0; i < 4; i++) {
            View tile = root.findViewById(tileIds[i]);
            heroTileWraps[i] = tile;
            if (tile != null) {
                heroTileImgs[i] = tile.findViewById(R.id.tv_tile_img);
                heroTileTitles[i] = tile.findViewById(R.id.tv_tile_title);
            }
        }
        wireHeroClicks();
    }

    private void wireHeroClicks() {
        if (heroSlideWrap != null) {
            heroSlideWrap.setOnClickListener(v -> openHeroSlide());
            bindEnter(heroSlideWrap, this::openHeroSlide);
            heroSlideWrap.setOnFocusChangeListener((v, has) -> TvFocusAnim.applyPoster(v, has));
        }
        if (heroFixedWrap != null) {
            heroFixedWrap.setOnClickListener(v -> openHeroFixed());
            bindEnter(heroFixedWrap, this::openHeroFixed);
            heroFixedWrap.setOnFocusChangeListener((v, has) -> TvFocusAnim.applyPoster(v, has));
        }
        for (int i = 0; i < 4; i++) {
            final int idx = i;
            if (heroTileWraps[i] != null) {
                heroTileWraps[i].setOnClickListener(v -> openHeroTile(idx));
                bindEnter(heroTileWraps[i], () -> openHeroTile(idx));
                heroTileWraps[i].setOnFocusChangeListener((v, has) -> TvFocusAnim.applyPoster(v, has));
            }
        }
    }

    private void stopHeroRotation() {
        handler.removeCallbacks(heroRotateRunnable);
    }

    private void openHeroSlide() {
        if (heroRotating.isEmpty()) return;
        openCatalogItem(heroRotating.get(heroRotateIndex));
    }

    private void openHeroFixed() {
        if (heroFixedItem != null) openCatalogItem(heroFixedItem);
    }

    private void openHeroTile(int idx) {
        if (idx >= 0 && idx < 4 && heroBottomTiles[idx] != null) {
            openCatalogItem(heroBottomTiles[idx]);
        }
    }

    private void loadMovies() {
        lastCatalogType = "movies";
        loadCatalogStart();
        executor.execute(() -> {
            try {
                VixApi api = new VixApi(this);
                HeroData hero = fetchMoviesHero(api);
                List<CatalogRow> rows = new ArrayList<>();
                JSONArray genreRows = api.moviesGenreRows();
                for (int i = 0; i < genreRows.length(); i++) {
                    JSONObject row = genreRows.getJSONObject(i);
                    JSONArray items = row.optJSONArray("movies");
                    if (items == null) items = row.optJSONArray("items");
                    if (items == null || items.length() == 0) continue;
                    int total = row.optInt("count", items.length());
                    int max = Math.min(ROW_PREVIEW_MAX, items.length());
                    List<CatalogItem> list = new ArrayList<>();
                    for (int j = 0; j < max; j++) {
                        list.add(itemFromMovie(items.getJSONObject(j)));
                    }
                    rows.add(new CatalogRow(
                        row.optString("genre", ""),
                        list,
                        false,
                        null,
                        row.optString("genre", ""),
                        "movie",
                        total
                    ));
                }
                publishMovies(hero, rows);
            } catch (Exception e) {
                publishCatalogError(e);
            }
        });
    }

    private HeroData fetchMoviesHero(VixApi api) throws Exception {
        List<CatalogItem> allHero = new ArrayList<>();
        JSONArray hero = api.moviesHero();
        for (int i = 0; i < hero.length(); i++) {
            allHero.add(itemFromMovie(hero.getJSONObject(i)));
        }
        CatalogItem fixed = allHero.isEmpty() ? null : allHero.get(0);
        List<CatalogItem> rotating = new ArrayList<>();
        for (int i = 1; i < allHero.size(); i++) rotating.add(allHero.get(i));
        if (rotating.isEmpty() && fixed != null) rotating.add(fixed);
        CatalogItem[] tiles = new CatalogItem[4];
        try {
            JSONArray recent = api.moviesRecent();
            for (int i = 0; i < 4 && i < recent.length(); i++) {
                tiles[i] = itemFromMovie(recent.getJSONObject(i));
            }
        } catch (Exception ignored) { }
        for (int i = 0; i < 4; i++) {
            if (tiles[i] != null) continue;
            int src = i + 1;
            if (src < allHero.size()) tiles[i] = allHero.get(src);
        }
        return new HeroData(rotating, fixed, tiles);
    }

    private void publishMovies(HeroData hero, List<CatalogRow> rows) {
        runOnUiThread(() -> {
            catalogLoading.setVisibility(View.GONE);
            heroRotating.clear();
            heroRotating.addAll(hero.rotating);
            heroFixedItem = hero.fixed;
            heroRotateIndex = 0;
            for (int i = 0; i < 4; i++) heroBottomTiles[i] = hero.tiles[i];
            catalogRows.clear();
            catalogRows.addAll(rows);
            catalogAdapter.notifyDataSetChanged();
            boolean empty = rows.isEmpty() && !hasListHero();
            catalogEmpty.setVisibility(empty ? View.VISIBLE : View.GONE);
        });
    }

    private void loadStorefront(String slug) {
        lastCatalogType = slug;
        loadCatalogStart();
        executor.execute(() -> {
            try {
                VixApi api = new VixApi(this);
                try {
                    JSONObject page = api.catalogStorefront(slug);
                    HeroData hero = buildHeroFromStorefront(api, page);
                    List<CatalogRow> rows = parseStorefrontSections(page);
                    if (!rows.isEmpty() || hero.fixed != null || !hero.rotating.isEmpty()) {
                        HeroData finalHero = hero;
                        runOnUiThread(() -> publishStorefront(finalHero, rows));
                        return;
                    }
                } catch (Exception ignored) {
                    /* API storefront no disponible: usar endpoints clásicos */
                }
                loadStorefrontLegacy(api, slug);
            } catch (Exception e) {
                publishCatalogError(e);
            }
        });
    }

    private void loadStorefrontLegacy(VixApi api, String slug) throws Exception {
        HeroData hero;
        List<CatalogRow> rows = new ArrayList<>();
        if ("series".equals(slug)) {
            hero = buildSeriesHero(api);
            appendGenreRows(rows, api.seriesGenreRows(), "series", "series");
        } else if ("movies".equals(slug)) {
            hero = fetchMoviesHero(api);
            appendGenreRows(rows, api.moviesGenreRows(), "movies", "movie");
        } else if ("destacados".equals(slug)) {
            hero = fetchMoviesHero(api);
            appendGenreRows(rows, api.moviesGenreRows(), "movies", "movie");
            appendGenreRows(rows, api.seriesGenreRows(), "series", "series");
        } else {
            hero = fetchMoviesHero(api);
            appendGenreRows(rows, api.moviesGenreRows(), "movies", "movie");
            if ("explorar".equals(slug)) {
                appendGenreRows(rows, api.seriesGenreRows(), "series", "series");
            }
        }
        HeroData finalHero = hero;
        List<CatalogRow> finalRows = rows;
        runOnUiThread(() -> publishStorefront(finalHero, finalRows));
    }

    private HeroData buildSeriesHero(VixApi api) throws Exception {
        List<CatalogItem> allHero = new ArrayList<>();
        JSONArray seriesHero = api.seriesHero();
        for (int i = 0; i < seriesHero.length(); i++) {
            allHero.add(itemFromSeries(seriesHero.getJSONObject(i)));
        }
        CatalogItem fixed = allHero.isEmpty() ? null : allHero.get(0);
        List<CatalogItem> rotating = new ArrayList<>();
        for (int i = 1; i < allHero.size(); i++) rotating.add(allHero.get(i));
        if (rotating.isEmpty() && fixed != null) rotating.add(fixed);
        CatalogItem[] tiles = new CatalogItem[4];
        for (int i = 0; i < 4 && i < allHero.size(); i++) {
            tiles[i] = allHero.get(Math.min(i + 1, allHero.size() - 1));
        }
        return new HeroData(rotating, fixed, tiles);
    }

    private void appendGenreRows(List<CatalogRow> rows, JSONArray genreRows, String arrayKey, String rowType) throws Exception {
        for (int i = 0; i < genreRows.length(); i++) {
            JSONObject row = genreRows.getJSONObject(i);
            JSONArray items = row.optJSONArray(arrayKey);
            if (items == null) items = row.optJSONArray("items");
            if (items == null || items.length() == 0) continue;
            int total = row.optInt("count", items.length());
            int max = Math.min(ROW_PREVIEW_MAX, items.length());
            List<CatalogItem> list = new ArrayList<>();
            for (int j = 0; j < max; j++) {
                JSONObject o = items.getJSONObject(j);
                list.add("series".equals(rowType) ? itemFromSeries(o) : itemFromMovie(o));
            }
            rows.add(new CatalogRow(
                row.optString("genre", row.optString("title", "")),
                list,
                false,
                null,
                row.optString("genre", ""),
                rowType,
                total
            ));
        }
    }

    private HeroData buildHeroFromStorefront(VixApi api, JSONObject page) throws Exception {
        List<CatalogItem> allHero = new ArrayList<>();
        String slug = page.optString("slug", "");
        if ("movies".equals(slug)) {
            return fetchMoviesHero(api);
        }
        if ("series".equals(slug)) {
            JSONArray seriesHero = api.seriesHero();
            for (int i = 0; i < seriesHero.length(); i++) {
                allHero.add(itemFromSeries(seriesHero.getJSONObject(i)));
            }
        } else {
            JSONArray hero = page.optJSONArray("hero");
            if (hero != null) {
                for (int i = 0; i < hero.length(); i++) {
                    allHero.add(itemFromStorefront(hero.getJSONObject(i)));
                }
            }
        }
        CatalogItem fixed = allHero.isEmpty() ? null : allHero.get(0);
        List<CatalogItem> rotating = new ArrayList<>();
        for (int i = 1; i < allHero.size(); i++) rotating.add(allHero.get(i));
        if (rotating.isEmpty() && fixed != null) rotating.add(fixed);
        CatalogItem[] tiles = new CatalogItem[4];
        JSONArray recent = page.optJSONArray("recent");
        if (recent != null) {
            for (int i = 0; i < Math.min(4, recent.length()); i++) {
                tiles[i] = itemFromStorefront(recent.getJSONObject(i));
            }
        }
        for (int i = 0; i < 4; i++) {
            if (tiles[i] != null) continue;
            int src = i + 1;
            if (src < allHero.size()) tiles[i] = allHero.get(src);
        }
        return new HeroData(rotating, fixed, tiles);
    }

    private List<CatalogRow> parseStorefrontSections(JSONObject page) {
        List<CatalogRow> rows = new ArrayList<>();
        JSONArray sections = page.optJSONArray("sections");
        if (sections == null) return rows;
        try {
            for (int i = 0; i < sections.length(); i++) {
                JSONObject sec = sections.optJSONObject(i);
                if (sec == null) continue;
                JSONArray items = sec.optJSONArray("items");
                if (items == null || items.length() == 0) continue;
                int total = sec.optInt("total", items.length());
                int max = Math.min(ROW_PREVIEW_MAX, items.length());
                List<CatalogItem> list = new ArrayList<>();
                for (int j = 0; j < max; j++) {
                    list.add(itemFromStorefront(items.getJSONObject(j)));
                }
                String rowType = sec.optString("type", "movie");
                if ("mixed".equals(rowType)) {
                    rowType = items.getJSONObject(0).optString("content_type", "movie");
                }
                rows.add(new CatalogRow(
                    sec.optString("title", ""),
                    list,
                    false,
                    sec.optString("id", ""),
                    sec.optString("genre", ""),
                    rowType,
                    total
                ));
            }
        } catch (org.json.JSONException ignored) { /* fila inválida */ }
        return rows;
    }

    private CatalogItem itemFromStorefront(JSONObject o) {
        if ("series".equals(o.optString("content_type", ""))) return itemFromSeries(o);
        return itemFromMovie(o);
    }

    private void publishStorefront(HeroData hero, List<CatalogRow> rows) {
        catalogLoading.setVisibility(View.GONE);
        heroRotating.clear();
        heroRotating.addAll(hero.rotating);
        heroFixedItem = hero.fixed;
        heroRotateIndex = 0;
        for (int i = 0; i < 4; i++) heroBottomTiles[i] = hero.tiles[i];
        catalogRows.clear();
        catalogRows.addAll(rows);
        catalogAdapter.notifyDataSetChanged();
        boolean empty = rows.isEmpty() && !hasListHero();
        catalogEmpty.setVisibility(empty ? View.VISIBLE : View.GONE);
        bindHomeHero();
        startHeroRotation();
    }

    private void loadCatalogStart() {
        runOnUiThread(() -> {
            catalogLoading.setVisibility(View.VISIBLE);
            catalogEmpty.setVisibility(View.GONE);
        });
    }

    private void publishCatalog(List<CatalogRow> rows) {
        runOnUiThread(() -> {
            catalogLoading.setVisibility(View.GONE);
            catalogRows.clear();
            catalogRows.addAll(rows);
            catalogAdapter.notifyDataSetChanged();
            catalogEmpty.setVisibility(rows.isEmpty() ? View.VISIBLE : View.GONE);
        });
    }

    private void publishCatalogError(Exception e) {
        runOnUiThread(() -> {
            catalogLoading.setVisibility(View.GONE);
            catalogEmpty.setVisibility(View.VISIBLE);
            catalogEmpty.setText(e.getMessage());
            Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
        });
    }

    private CatalogItem itemFromMovie(JSONObject m) {
        return new CatalogItem(
            m.optInt("id", 0),
            m.optString("title", ""),
            m.optString("poster", ""),
            m.optString("backdrop", ""),
            heroBannerFromJson(m, false),
            m.optString("trailer", ""),
            m.optString("video_path", ""),
            false,
            "movie",
            0,
            0,
            0,
            null,
            TvPosterBind.ratingFromJson(m)
        );
    }

    private CatalogItem itemFromSeries(JSONObject s) {
        return new CatalogItem(
            s.optInt("id", 0),
            s.optString("title", ""),
            s.optString("poster", ""),
            s.optString("backdrop", s.optString("poster", "")),
            heroBannerFromJson(s, true),
            s.optString("trailer", ""),
            null,
            true,
            "series",
            0,
            0,
            0,
            null,
            TvPosterBind.ratingFromJson(s)
        );
    }

    private CatalogItem itemFromContinue(JSONObject c) {
        String type = c.optString("content_type", "movie");
        boolean isEp = "episode".equals(type);
        String title = c.optString("title", "");
        if (isEp) title = c.optString("series_title", "") + " · " + title;
        long prog = (long) c.optDouble("progress", 0);
        long dur = (long) c.optDouble("duration", 0);
        int pct = dur > 0 ? (int) Math.min(100, (prog * 100) / dur) : 0;
        return new CatalogItem(
            c.optInt("content_id", 0),
            title,
            c.optString("poster", ""),
            "",
            "",
            "",
            c.optString("video_path", ""),
            isEp,
            type,
            c.optInt("series_id", 0),
            prog,
            dur,
            pct > 0 ? pct + "% visto" : null,
            TvPosterBind.ratingFromJson(c)
        );
    }

    private void openCatalogItem(CatalogItem item) {
        if (item.isSeries && "series".equals(item.contentType)) {
            Intent i = new Intent(this, TvSeriesDetailActivity.class);
            i.putExtra(TvSeriesDetailActivity.EXTRA_SERIES_ID, item.id);
            TvPreviewExtras.put(i, item.title, item.banner, item.backdrop, item.poster);
            startActivity(i);
            TvPreviewExtras.applyInstantTransition(this);
            return;
        }
        if ("episode".equals(item.contentType)) {
            if (item.videoPath == null || item.videoPath.isEmpty()) {
                Toast.makeText(this, "Video no disponible", Toast.LENGTH_LONG).show();
                return;
            }
            Intent i = new Intent(this, TvPlayerActivity.class);
            i.putExtra(TvPlayerActivity.EXTRA_TITLE, item.title);
            i.putExtra(TvPlayerActivity.EXTRA_VIDEO_PATH, item.videoPath);
            i.putExtra(TvPlayerActivity.EXTRA_START_SEC, item.progress);
            i.putExtra(TvPlayerActivity.EXTRA_CONTENT_TYPE, "episode");
            i.putExtra(TvPlayerActivity.EXTRA_CONTENT_ID, item.id);
            i.putExtra(TvPlayerActivity.EXTRA_SERIES_ID, item.seriesId);
            TvPreviewExtras.put(i, item.title, item.banner, item.backdrop, item.poster);
            startActivity(i);
            TvPreviewExtras.applyInstantTransition(this);
            return;
        }
        Intent i = new Intent(this, TvMovieDetailActivity.class);
        i.putExtra(TvMovieDetailActivity.EXTRA_MOVIE_ID, item.id);
        TvPreviewExtras.put(i, item.title, item.banner, item.backdrop, item.poster);
        startActivity(i);
        TvPreviewExtras.applyInstantTransition(this);
    }

    private void playChannelPreview(ChannelItem ch, int position) {
        if (ch == null || isFinishing() || currentSection != SEC_LIVE) return;
        int prev = selectedChannelPos;
        selectedChannelPos = position;
        lastWatchedLiveChannelId = ch.id;
        updateLiveNowPlaying(ch);
        if (liveChannelsList != null && channelAdapter != null && prev != position) {
            channelAdapter.notifyPlayingOnly(prev, position);
        }
        if (prev == position && livePlayer != null) {
            unmuteLivePreview();
            return;
        }

        handler.post(() -> {
            if (isFinishing() || currentSection != SEC_LIVE) return;
            try {
                ensureLivePlayer();
                if (livePlayer == null) return;
                String url = PlayUrls.live(serverBase, authToken, ch.id);
                if (url == null || url.isEmpty()) return;
                DefaultHttpDataSource.Factory factory = new DefaultHttpDataSource.Factory()
                    .setUserAgent("VixTV/1.0 tv")
                    .setAllowCrossProtocolRedirects(true);
                MediaSource source = new HlsMediaSource.Factory(factory)
                    .createMediaSource(MediaItem.fromUri(Uri.parse(url)));
                livePlayer.setMediaSource(source);
                livePlayer.prepare();
                livePlayer.setPlayWhenReady(true);
            } catch (Throwable t) {
                Toast.makeText(TvShellActivity.this, "Canal no disponible", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void loadPoster(ImageView iv, String poster) {
        loadPoster(iv, poster, null);
    }

    private void loadPoster(ImageView iv, String primary, String fallback) {
        if (iv == null) return;
        String url = PlayUrls.poster(serverBase, primary);
        String fallbackUrl = fallback != null ? PlayUrls.poster(serverBase, fallback) : "";
        Object tag = iv.getTag(R.id.tv_ch_logo);
        if (url.isEmpty()) {
            if (!fallbackUrl.isEmpty()) {
                loadPoster(iv, fallback, null);
                return;
            }
            iv.setTag(R.id.tv_ch_logo, "");
            iv.setImageDrawable(null);
            iv.setBackgroundResource(R.drawable.tv_channel_logo_placeholder);
            return;
        }
        if (url.equals(tag)) return;
        iv.setTag(R.id.tv_ch_logo, url);
        iv.setBackgroundResource(R.drawable.tv_channel_focus_bg);
        if (fallbackUrl.isEmpty() || fallbackUrl.equals(url)) {
            Glide.with(this).load(url).centerCrop().into(iv);
            return;
        }
        Glide.with(this)
            .load(url)
            .centerCrop()
            .error(Glide.with(this).load(fallbackUrl).centerCrop())
            .into(iv);
    }

    private void loadHeroImage(ImageView iv, CatalogItem item) {
        if (iv == null || item == null) return;
        String primary = heroImg(item);
        String fallback = TvPreviewExtras.pickImage("", item.backdrop, item.poster);
        if (fallback.isEmpty()) fallback = item.poster;
        loadPoster(iv, primary, fallback);
    }

    private void releasePlayer() {
        if (livePlayer != null) {
            livePlayer.stop();
            livePlayer.clearMediaItems();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        loadNotifyBadge();
        if (currentSection == SEC_HOME && "home".equals(lastCatalogType)) {
            refreshContinueRow(null);
        }
    }

    private void handleLiveChannelIntent(Intent intent) {
        if (intent == null) return;
        int channelId = intent.getIntExtra(EXTRA_LIVE_CHANNEL_ID, 0);
        if (channelId > 0) {
            intent.removeExtra(EXTRA_LIVE_CHANNEL_ID);
            tuneLiveChannel(channelId);
        }
    }

    @Override
    protected void onStop() {
        if (currentSection != SEC_LIVE) {
            releasePlayer();
        } else if (!liveInlineFullscreen && livePlayer != null) {
            livePlayer.setPlayWhenReady(false);
        }
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        stopHeroRotation();
        handler.removeCallbacksAndMessages(null);
        executor.shutdownNow();
        if (livePlayer != null) {
            livePlayer.release();
            livePlayer = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        UpdateChecker.handleUpdateIntent(this, intent);
        handleLiveChannelIntent(intent);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
                if (currentSection == SEC_LIVE && liveFsChannelPanelOpen) {
                    closeLiveChannelPanelOnly();
                    focusLiveCategory(liveSelectedCategoryPos);
                    return true;
                }
                if (currentSection == SEC_LIVE && liveCategoryPanelOpen) {
                    closeLivePanels();
                    if (livePlayerWrap != null) livePlayerWrap.requestFocus();
                    return true;
                }
                if (liveInlineFullscreen) {
                    exitLiveInlineFullscreen();
                    return true;
                }
                if (currentSection != SEC_HOME) {
                    switchSection(SEC_HOME);
                    navHome.requestFocus();
                    return true;
                }
            }
            if (currentSection == SEC_LIVE) {
                int keyCode = event.getKeyCode();
                if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
                    if (isFocusInLiveFsChannelPanel()) {
                        focusLiveCategory(liveSelectedCategoryPos);
                        return true;
                    }
                    if (shouldHandleLiveCategoryKey()) {
                        toggleLiveCategoryPanel();
                        return true;
                    }
                }
                if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                    if (liveCategoryPanelOpen || isFocusInLiveCategoryPanel()) {
                        int catPos = liveSelectedCategoryPos;
                        View focus = getCurrentFocus();
                        if (liveCategoriesList != null && focus != null) {
                            RecyclerView.ViewHolder h = liveCategoriesList.findContainingViewHolder(focus);
                            if (h != null && h.getBindingAdapterPosition() >= 0) {
                                catPos = h.getBindingAdapterPosition();
                            }
                        }
                        openLiveChannelPanelForCategory(catPos);
                        return true;
                    }
                }
                if (isSelectKey(keyCode) && liveInlineFullscreen && liveCategoryPanelOpen && !liveFsChannelPanelOpen) {
                    openLiveChannelPanel();
                    return true;
                }
                if (isLiveZapKey(keyCode) && liveInlineFullscreen
                    && !liveCategoryPanelOpen && !liveFsChannelPanelOpen) {
                    zapLiveChannel(liveZapDelta(keyCode));
                    return true;
                }
                if (keyCode == KeyEvent.KEYCODE_MENU && liveChannelsList != null) {
                    focusLiveChannelList();
                    return true;
                }
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private static class LiveEpgInfo {
        final String nowTitle;
        final String nowSubtitle;
        final String nowRange;
        final String nextTitle;
        final String nextSubtitle;
        final String nextRange;
        final int progress;

        LiveEpgInfo(String nowTitle, String nowSubtitle, String nowRange,
                    String nextTitle, String nextSubtitle, String nextRange, int progress) {
            this.nowTitle = nowTitle != null ? nowTitle : "";
            this.nowSubtitle = nowSubtitle != null ? nowSubtitle : "";
            this.nowRange = nowRange != null ? nowRange : "";
            this.nextTitle = nextTitle != null ? nextTitle : "";
            this.nextSubtitle = nextSubtitle != null ? nextSubtitle : "";
            this.nextRange = nextRange != null ? nextRange : "";
            this.progress = progress;
        }

        static LiveEpgInfo fromJson(JSONObject entry) {
            JSONObject now = entry.optJSONObject("now");
            JSONObject next = entry.optJSONObject("next");
            String nowTitle = now != null ? now.optString("title", "") : "";
            String nowSub = now != null ? now.optString("subtitle", "") : "";
            String nowRange = now != null ? now.optString("range", "") : "";
            int progress = now != null ? (int) Math.round(now.optDouble("progress", 0)) : 0;
            String nextTitle = next != null ? next.optString("title", "") : "";
            String nextSub = next != null ? next.optString("subtitle", "") : "";
            String nextRange = next != null ? next.optString("range", "") : "";
            return new LiveEpgInfo(nowTitle, nowSub, nowRange, nextTitle, nextSub, nextRange, progress);
        }

        static LiveEpgInfo fallback(ChannelItem ch) {
            String group = ch.group != null && !ch.group.isEmpty() ? ch.group : "En vivo";
            return new LiveEpgInfo(ch.name, group, "00:00-23:59", "", "", "", 0);
        }
    }

    private static class ChannelItem {
        final int id;
        final String name;
        final String logo;
        final String group;
        ChannelItem(int id, String name, String logo, String group) {
            this.id = id;
            this.name = name;
            this.logo = logo;
            this.group = group != null ? group : "";
        }
    }

    private static class CatalogItem {
        final int id;
        final String title;
        final String poster;
        final String videoPath;
        final boolean isSeries;
        final String contentType;
        final int seriesId;
        final long progress;
        final long duration;
        final String subtitle;
        final String backdrop;
        final String banner;
        final String trailer;
        final double rating;

        CatalogItem(int id, String title, String poster, String backdrop, String banner, String trailer,
                    String videoPath, boolean isSeries, String contentType, int seriesId,
                    long progress, long duration, String subtitle, double rating) {
            this.id = id;
            this.title = title;
            this.poster = poster;
            this.backdrop = backdrop;
            this.banner = banner;
            this.trailer = trailer;
            this.videoPath = videoPath;
            this.isSeries = isSeries;
            this.contentType = contentType;
            this.seriesId = seriesId;
            this.progress = progress;
            this.duration = duration;
            this.subtitle = subtitle;
            this.rating = rating;
        }
    }

    private static class HeroData {
        final List<CatalogItem> rotating;
        final CatalogItem fixed;
        final CatalogItem[] tiles;
        HeroData(List<CatalogItem> rotating, CatalogItem fixed, CatalogItem[] tiles) {
            this.rotating = rotating;
            this.fixed = fixed;
            this.tiles = tiles;
        }
    }

    private void openRowSeeMore(CatalogRow row) {
        if (row.continueRow) {
            startActivity(new Intent(this, TvHistoryActivity.class));
            return;
        }
        Intent i = new Intent(this, TvCategoryBrowseActivity.class);
        i.putExtra(TvCategoryBrowseActivity.EXTRA_TITLE, row.label);
        if (row.sectionId != null && !row.sectionId.isEmpty()) {
            i.putExtra(TvCategoryBrowseActivity.EXTRA_SECTION_ID, row.sectionId);
        }
        if (row.genre != null && !row.genre.isEmpty()) {
            i.putExtra(TvCategoryBrowseActivity.EXTRA_GENRE, row.genre);
        }
        String type = row.rowType != null ? row.rowType : "movie";
        i.putExtra(TvCategoryBrowseActivity.EXTRA_ROW_TYPE, type);
        startActivity(i);
    }

    private static class CatalogRow {
        final String label;
        final List<CatalogItem> items;
        final boolean hero;
        final String sectionId;
        final String genre;
        final String rowType;
        final int totalCount;
        final boolean continueRow;

        CatalogRow(String label, List<CatalogItem> items, boolean hero) {
            this(label, items, hero, null, null, "movie", items != null ? items.size() : 0, false);
        }

        CatalogRow(String label, List<CatalogItem> items, boolean hero,
                   String sectionId, String genre, String rowType, int totalCount) {
            this(label, items, hero, sectionId, genre, rowType, totalCount, false);
        }

        CatalogRow(String label, List<CatalogItem> items, boolean hero,
                   String sectionId, String genre, String rowType, int totalCount, boolean continueRow) {
            this.label = label;
            this.items = items;
            this.hero = hero;
            this.sectionId = sectionId;
            this.genre = genre;
            this.rowType = rowType;
            this.totalCount = totalCount > 0 ? totalCount : (items != null ? items.size() : 0);
            this.continueRow = continueRow;
        }

        boolean showSeeMore() {
            return items != null && !items.isEmpty() && totalCount > items.size();
        }
    }

    private class ChannelAdapter extends RecyclerView.Adapter<ChannelAdapter.H> {
        @NonNull
        @Override
        public H onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            H h = new H(getLayoutInflater().inflate(R.layout.item_tv_channel_compact, parent, false));
            h.inner.setOnFocusChangeListener((v, has) -> {
                int pos = h.getBindingAdapterPosition();
                if (pos < 0 || pos >= visibleChannels.size()) return;
                if (has) {
                    if (liveFullscreenBtn != null) liveFullscreenBtn.setVisibility(View.GONE);
                    if (liveChannelsList != null) liveChannelsList.smoothScrollToPosition(pos);
                    playChannelPreview(visibleChannels.get(pos), pos);
                }
            });
            return h;
        }

        void notifyPlayingOnly(int oldPos, int newPos) {
            if (oldPos >= 0) notifyItemChanged(oldPos, CHANNEL_PAYLOAD_PLAYING);
            if (newPos >= 0 && newPos != oldPos) notifyItemChanged(newPos, CHANNEL_PAYLOAD_PLAYING);
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position, @NonNull List<Object> payloads) {
            if (!payloads.isEmpty()) {
                bindPlayingUi(holder, position);
                return;
            }
            onBindViewHolder(holder, position);
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            ChannelItem ch = visibleChannels.get(position);
            if (holder.num.getVisibility() != View.GONE) {
                holder.num.setText(String.valueOf(position + 1));
            }
            holder.name.setText(ch.name);
            if (holder.epg.getVisibility() != View.GONE) {
                holder.epg.setText(ch.group.isEmpty() ? "En vivo" : ch.group);
            }
            loadPoster(holder.logo, ch.logo);
            bindPlayingUi(holder, position);
            holder.inner.setOnClickListener(v -> {
                int pos = holder.getBindingAdapterPosition();
                if (pos < 0 || pos >= visibleChannels.size()) return;
                playChannelPreview(visibleChannels.get(pos), pos);
                holder.inner.requestFocus();
            });
            if (livePlayerWrap != null) {
                holder.inner.setNextFocusLeftId(livePlayerWrap.getId());
            }
            bindEnter(holder.inner, () -> {
                int pos = holder.getBindingAdapterPosition();
                if (pos >= 0 && pos < visibleChannels.size()) {
                    playChannelPreview(visibleChannels.get(pos), pos);
                }
                enterLiveInlineFullscreen();
            });
        }

        private void bindPlayingUi(H holder, int position) {
            boolean playing = position == selectedChannelPos;
            holder.inner.setActivated(playing);
            holder.play.setVisibility(playing ? View.VISIBLE : View.INVISIBLE);
            holder.play.setAlpha(1f);
            holder.play.setScaleX(1f);
            holder.play.setScaleY(1f);
        }

        @Override
        public int getItemCount() { return visibleChannels.size(); }

        class H extends RecyclerView.ViewHolder {
            final View inner;
            final TextView num;
            final ImageView logo;
            final TextView name;
            final TextView epg;
            final TextView play;
            H(View v) {
                super(v);
                inner = v.findViewById(R.id.tv_ch_inner);
                num = v.findViewById(R.id.tv_ch_num);
                logo = v.findViewById(R.id.tv_ch_logo);
                name = v.findViewById(R.id.tv_ch_name);
                epg = v.findViewById(R.id.tv_ch_epg);
                play = v.findViewById(R.id.tv_ch_play);
            }
        }
    }

    private class LiveCategoryAdapter extends RecyclerView.Adapter<LiveCategoryAdapter.GH> {
        @NonNull
        @Override
        public GH onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            return new GH(getLayoutInflater().inflate(R.layout.item_tv_fs_group, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull GH holder, int position) {
            String name = liveCategoryNames.get(position);
            holder.label.setText(name);
            boolean selected = position == liveSelectedCategoryPos;
            holder.label.setSelected(selected);
            holder.label.setOnFocusChangeListener((v, has) -> {
                holder.label.setSelected(has || position == liveSelectedCategoryPos);
                if (has) liveSelectedCategoryPos = position;
            });
            holder.label.setOnClickListener(v -> selectLiveCategory(position));
            bindEnter(holder.label, () -> selectLiveCategory(position));
            holder.label.setOnKeyListener((v, keyCode, ev) -> {
                if (ev.getAction() == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                    openLiveChannelPanelForCategory(position);
                    return true;
                }
                return false;
            });
            if (liveFsChannelsList != null) {
                holder.label.setNextFocusRightId(liveFsChannelsList.getId());
            }
        }

        @Override
        public int getItemCount() {
            return liveCategoryNames.size();
        }

        class GH extends RecyclerView.ViewHolder {
            final TextView label;

            GH(View itemView) {
                super(itemView);
                label = itemView.findViewById(R.id.tv_grp_inner);
            }
        }
    }

    private class LiveFsChannelAdapter extends RecyclerView.Adapter<LiveFsChannelAdapter.CH> {
        @NonNull
        @Override
        public CH onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            return new CH(getLayoutInflater().inflate(R.layout.item_tv_channel, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull CH holder, int position) {
            ChannelItem ch = visibleChannels.get(position);
            holder.num.setText(String.valueOf(position + 1));
            holder.name.setText(ch.name);
            holder.epg.setText(ch.group.isEmpty() ? "En vivo" : ch.group);
            boolean playing = position == selectedChannelPos;
            holder.play.setVisibility(playing ? View.VISIBLE : View.INVISIBLE);
            loadPoster(holder.logo, ch.logo);
            if (liveCategoriesList != null) {
                holder.inner.setNextFocusLeftId(liveCategoriesList.getId());
            }
            holder.inner.setOnClickListener(v -> {
                playChannelPreview(ch, position);
                closeLivePanels();
                if (livePlayerWrap != null) livePlayerWrap.requestFocus();
            });
            bindEnter(holder.inner, () -> {
                playChannelPreview(ch, position);
                closeLivePanels();
                if (livePlayerWrap != null) livePlayerWrap.requestFocus();
            });
            holder.inner.setOnKeyListener((v, keyCode, ev) -> {
                if (ev.getAction() == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
                    focusLiveCategory(liveSelectedCategoryPos);
                    return true;
                }
                return false;
            });
        }

        @Override
        public int getItemCount() {
            return visibleChannels.size();
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

    private static boolean isSelectKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_DPAD_CENTER
            || keyCode == KeyEvent.KEYCODE_ENTER
            || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
            || keyCode == KeyEvent.KEYCODE_BUTTON_A;
    }

    private class CatalogAdapter extends RecyclerView.Adapter<RecyclerView.ViewHolder> {
        private static final int VT_HERO = 0;
        private static final int VT_ROW = 1;

        @Override
        public int getItemViewType(int position) {
            if (hasListHero() && position == 0) return VT_HERO;
            return VT_ROW;
        }

        @NonNull
        @Override
        public RecyclerView.ViewHolder onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            if (viewType == VT_HERO) {
                return new HeroHolder(getLayoutInflater().inflate(R.layout.item_tv_catalog_hero_header, parent, false));
            }
            return new RowHolder(getLayoutInflater().inflate(R.layout.item_tv_catalog_row, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull RecyclerView.ViewHolder holder, int position) {
            if (holder instanceof HeroHolder) {
                bindHeroFromView(holder.itemView);
                wireHeroClicks();
                bindHomeHero();
                startHeroRotation();
                return;
            }
            RowHolder rh = (RowHolder) holder;
            int rowIndex = hasListHero() ? position - 1 : position;
            CatalogRow row = catalogRows.get(rowIndex);
            rh.label.setText(row.label);
            rh.recycler.setLayoutManager(new LinearLayoutManager(TvShellActivity.this, LinearLayoutManager.HORIZONTAL, false));
            rh.recycler.setAdapter(new RowItemsAdapter(row));
        }

        @Override
        public int getItemCount() {
            return catalogRows.size() + (hasListHero() ? 1 : 0);
        }

        class HeroHolder extends RecyclerView.ViewHolder {
            HeroHolder(View v) { super(v); }
        }

        class RowHolder extends RecyclerView.ViewHolder {
            final TextView label;
            final RecyclerView recycler;
            RowHolder(View v) {
                super(v);
                label = v.findViewById(R.id.tv_row_label);
                recycler = v.findViewById(R.id.tv_row_items);
            }
        }
    }

    private class RowItemsAdapter extends RecyclerView.Adapter<RecyclerView.ViewHolder> {
        private static final int VT_POSTER = 0;
        private static final int VT_MORE = 1;

        private final CatalogRow row;

        RowItemsAdapter(CatalogRow row) {
            this.row = row;
        }

        @Override
        public int getItemViewType(int position) {
            if (row.showSeeMore() && position == row.items.size()) return VT_MORE;
            return VT_POSTER;
        }

        @NonNull
        @Override
        public RecyclerView.ViewHolder onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            if (viewType == VT_MORE) {
                return new MoreHolder(getLayoutInflater().inflate(R.layout.item_tv_more, parent, false));
            }
            return new PosterHolder(getLayoutInflater().inflate(R.layout.item_tv_poster, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull RecyclerView.ViewHolder holder, int position) {
            if (holder instanceof MoreHolder) {
                MoreHolder mh = (MoreHolder) holder;
                mh.itemView.setOnClickListener(v -> openRowSeeMore(row));
                bindEnter(mh.itemView, () -> openRowSeeMore(row));
                mh.itemView.setOnFocusChangeListener((v, has) -> TvFocusAnim.applyPoster(v, has));
                return;
            }
            PosterHolder ph = (PosterHolder) holder;
            CatalogItem item = row.items.get(position);
            ph.title.setText(item.title);
            loadPoster(ph.image, item.poster);
            if (row.continueRow) {
                TvPosterBind.bindRatingBadge(ph.rating, 0);
                int pct = continueProgressPercent(item);
                if (pct > 0) {
                    ph.progress.setVisibility(View.VISIBLE);
                    android.view.ViewGroup.LayoutParams lp = ph.progress.getLayoutParams();
                    int fullW = ph.image.getLayoutParams().width;
                    if (fullW <= 0) fullW = (int) (144 * getResources().getDisplayMetrics().density);
                    lp.width = (int) (fullW * (pct / 100f));
                    ph.progress.setLayoutParams(lp);
                    ph.progressLabel.setVisibility(View.VISIBLE);
                    ph.progressLabel.setText(item.subtitle != null ? item.subtitle : (pct + "% visto"));
                } else {
                    ph.progress.setVisibility(View.GONE);
                    ph.progressLabel.setVisibility(View.GONE);
                }
            } else {
                ph.progress.setVisibility(View.GONE);
                ph.progressLabel.setVisibility(View.GONE);
                TvPosterBind.bindRatingBadge(ph.rating, item.rating);
            }
            ph.itemView.setOnClickListener(v -> openCatalogItem(item));
            bindEnter(ph.itemView, () -> openCatalogItem(item));
            ph.itemView.setOnFocusChangeListener((v, has) -> TvFocusAnim.applyPoster(v, has));
        }

        @Override
        public int getItemCount() {
            int n = row.items.size();
            return row.showSeeMore() ? n + 1 : n;
        }

        class PosterHolder extends RecyclerView.ViewHolder {
            final ImageView image;
            final TextView title;
            final TextView rating;
            final View progress;
            final TextView progressLabel;

            PosterHolder(View v) {
                super(v);
                image = v.findViewById(R.id.tv_poster_img);
                title = v.findViewById(R.id.tv_poster_title);
                rating = v.findViewById(R.id.tv_poster_rating);
                progress = v.findViewById(R.id.tv_poster_progress);
                progressLabel = v.findViewById(R.id.tv_poster_progress_label);
            }
        }

        class MoreHolder extends RecyclerView.ViewHolder {
            MoreHolder(View v) {
                super(v);
            }
        }
    }

    private void bindEnter(View v, Runnable action) {
        v.setOnKeyListener((view, keyCode, ev) -> {
            if (ev.getAction() == KeyEvent.ACTION_DOWN && isEnterKey(keyCode)) {
                action.run();
                return true;
            }
            return false;
        });
    }

    private boolean isEnterKey(int code) {
        return code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
            || code == KeyEvent.KEYCODE_NUMPAD_ENTER || code == KeyEvent.KEYCODE_BUTTON_A;
    }
}
