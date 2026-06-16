package tv.vix.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import androidx.media3.ui.PlayerView;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;

import org.json.JSONObject;

import tv.vix.app.CatalogModels.CatalogItem;
import tv.vix.app.CatalogModels.CatalogRow;
import tv.vix.app.CatalogModels.HeroData;

public class MobileHomeFragment extends Fragment {
    private static final long HERO_ROTATE_MS = 32_000L;
    private static final long WORLDCUP_REFRESH_MS = 60_000L;
    private static final String[][] TABS = {
        {"home", "mobile_chip_home"},
        {"destacados", "mobile_chip_destacados"},
        {"movies", "mobile_chip_movies"},
        {"series", "mobile_chip_series"},
        {"kids", "mobile_chip_kids"},
        {"anime", "mobile_chip_anime"},
        {"explorar", "mobile_chip_explore"},
        {"categories", "mobile_chip_categories"},
    };

    private final Handler heroHandler = new Handler(Looper.getMainLooper());
    private final Runnable heroRunnable = this::advanceHero;
    private final Random heroRandom = new Random();

    private LinearLayout chips;
    private HorizontalScrollView chipsScroll;
    private FrameLayout heroWrap;
    private ImageView heroImg;
    private TextView heroTitle;
    private LinearLayout heroDots;
    private RecyclerView rowsList;
    private ProgressBar loading;
    private TextView empty;
    private EditText searchField;
    private MobileCatalogRowsAdapter rowsAdapter;
    private MobileWorldCupAdapter worldCupAdapter;
    private MobileHeroTrailerPlayer trailerPlayer;
    private View worldCupSection;
    private View worldCupLiveDot;
    private TextView worldCupTitle;
    private RecyclerView worldCupList;

    private String currentSlug = "home";
    private boolean hasPublished;
    private String serverBase = "";
    private final Handler worldCupHandler = new Handler(Looper.getMainLooper());
    private final Runnable worldCupRefreshRunnable = () -> {
        if (isAdded() && "home".equals(currentSlug)) loadWorldCup();
        scheduleWorldCupRefresh();
    };
    private List<CatalogItem> heroSlides = new ArrayList<>();
    private int heroIndex;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_mobile_home, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        serverBase = ServerUrlHelper.fromPrefs(
            requireContext().getSharedPreferences(AppConstants.PREFS, android.content.Context.MODE_PRIVATE));

        chips = view.findViewById(R.id.mobile_home_chips);
        chipsScroll = view.findViewById(R.id.mobile_home_chips_scroll);
        heroWrap = view.findViewById(R.id.mobile_home_hero);
        heroImg = view.findViewById(R.id.mobile_home_hero_img);
        heroTitle = view.findViewById(R.id.mobile_home_hero_title);
        heroDots = view.findViewById(R.id.mobile_home_hero_dots);
        rowsList = view.findViewById(R.id.mobile_home_rows);
        loading = view.findViewById(R.id.mobile_home_loading);
        empty = view.findViewById(R.id.mobile_home_empty);
        searchField = view.findViewById(R.id.mobile_home_search);

        worldCupSection = view.findViewById(R.id.mobile_home_worldcup);
        worldCupLiveDot = view.findViewById(R.id.mobile_home_worldcup_dot);
        worldCupTitle = view.findViewById(R.id.mobile_home_worldcup_title);
        worldCupList = view.findViewById(R.id.mobile_home_worldcup_list);
        worldCupAdapter = new MobileWorldCupAdapter(match -> {
            int channelId = match.optInt("channel_id", 0);
            String channelName = match.optString("channel_name", "DSports");
            CatalogNavigator.openLive(requireContext(), channelId, channelName);
        });
        worldCupList.setLayoutManager(new LinearLayoutManager(requireContext(), LinearLayoutManager.HORIZONTAL, false));
        worldCupList.setAdapter(worldCupAdapter);
        worldCupList.setNestedScrollingEnabled(false);

        rowsAdapter = new MobileCatalogRowsAdapter(requireContext());
        rowsList.setLayoutManager(new LinearLayoutManager(requireContext()));
        rowsList.setAdapter(rowsAdapter);
        rowsList.setNestedScrollingEnabled(false);

        searchField.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                startActivity(new Intent(requireContext(), TvSearchActivity.class));
                return true;
            }
            return false;
        });
        ImageButton profile = view.findViewById(R.id.mobile_home_profile);
        profile.setOnClickListener(v -> {
            if (requireActivity() instanceof MobileMainActivity) {
                ((MobileMainActivity) requireActivity()).selectTab(R.id.mobile_nav_profile);
            }
        });

        buildChips();
        PlayerView heroPlayer = view.findViewById(R.id.mobile_home_hero_player);
        ImageButton heroMute = view.findViewById(R.id.mobile_home_hero_mute);
        trailerPlayer = new MobileHeroTrailerPlayer(this, heroPlayer, heroMute, heroImg);
        heroWrap.setOnClickListener(v -> openCurrentHero());
        restoreFromCacheOrLoad();
    }

    private void restoreFromCacheOrLoad() {
        MobileContentCache.CatalogSnapshot snap = MobileContentCache.getCatalog(currentSlug);
        if (snap != null) {
            publish(snap.hero, snap.rows);
            return;
        }
        loadTab(currentSlug);
    }

    private void buildChips() {
        chips.removeAllViews();
        for (String[] tab : TABS) {
            int labelId = getResources().getIdentifier(tab[1], "string", requireContext().getPackageName());
            String label = labelId != 0 ? getString(labelId) : tab[0];
            String slug = tab[0];
            TextView chip = MobileUi.createHomeChip(requireContext(), label,
                slug.equals(currentSlug), () -> selectTab(slug, true));
            chip.setTag(slug);
            chips.addView(chip);
        }
    }

    private void refreshChipStyles() {
        for (int i = 0; i < chips.getChildCount(); i++) {
            View child = chips.getChildAt(i);
            if (!(child instanceof TextView) || !(child.getTag() instanceof String)) continue;
            boolean active = currentSlug.equals(child.getTag());
            TextView chip = (TextView) child;
            chip.setTypeface(chip.getTypeface(), active ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
            chip.setTextColor(getResources().getColor(active ? R.color.mobile_accent : R.color.mobile_muted));
            chip.setBackgroundResource(active ? R.drawable.mobile_chip_active : R.drawable.mobile_chip_inactive);
            if (active) {
                chipsScroll.post(() -> chipsScroll.smoothScrollTo((int) child.getX(), 0));
            }
        }
    }

    private void selectTab(String slug, boolean force) {
        if (!force && slug.equals(currentSlug) && hasPublished) return;
        currentSlug = slug;
        refreshChipStyles();
        updateWorldCupVisibility();
        loadTab(slug);
    }

    private void loadTab(String slug) {
        MobileContentCache.CatalogSnapshot snap = MobileContentCache.getCatalog(slug);
        if (snap != null) {
            publish(snap.hero, snap.rows);
            return;
        }
        loading.setVisibility(View.VISIBLE);
        empty.setVisibility(View.GONE);
        MobileContentCache.ensureCatalog(requireContext(), slug);
        CatalogLoader.Callback cb = new CatalogLoader.Callback() {
            @Override
            public void onLoaded(HeroData hero, List<CatalogRow> rows) {
                if (!isAdded()) return;
                requireActivity().runOnUiThread(() -> publish(hero, rows));
            }

            @Override
            public void onError(Exception error) {
                if (!isAdded()) return;
                requireActivity().runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    if (TvSessionHelper.isAuthError(error)) {
                        TvSessionHelper.redirectToLogin(requireActivity(), error.getMessage());
                        return;
                    }
                    Toast.makeText(requireContext(),
                        error.getMessage() != null ? error.getMessage() : "Error", Toast.LENGTH_LONG).show();
                    empty.setVisibility(View.VISIBLE);
                });
            }
        };
        if ("home".equals(slug)) CatalogLoader.loadHome(requireContext(), cb);
        else if ("categories".equals(slug)) CatalogLoader.loadCategories(requireContext(), cb);
        else CatalogLoader.loadStorefront(requireContext(), slug, cb);
    }

    private void publish(HeroData hero, List<CatalogRow> rows) {
        loading.setVisibility(View.GONE);
        hasPublished = true;
        MobileContentCache.putCatalog(currentSlug, hero, rows);
        heroSlides.clear();
        if (hero != null) {
            if (hero.fixed != null) heroSlides.add(hero.fixed);
            if (hero.rotating != null) {
                for (CatalogItem item : hero.rotating) {
                    if (hero.fixed == null || item.id != hero.fixed.id) heroSlides.add(item);
                }
            }
        }
        if (heroSlides.size() > 1) {
            Collections.shuffle(heroSlides, heroRandom);
        }
        heroIndex = heroSlides.isEmpty() ? 0 : heroRandom.nextInt(heroSlides.size());
        if (!heroSlides.isEmpty()) {
            heroWrap.setVisibility(View.VISIBLE);
            showHeroAt(heroIndex);
            startHeroRotation();
        } else {
            heroWrap.setVisibility(View.GONE);
            stopHeroRotation();
            if (trailerPlayer != null) trailerPlayer.stop();
        }
        rowsAdapter.setRows(rows);
        empty.setVisibility((rows == null || rows.isEmpty()) && heroSlides.isEmpty()
            ? View.VISIBLE : View.GONE);
        updateWorldCupVisibility();
        if ("home".equals(currentSlug)) loadWorldCup();
    }

    private void updateWorldCupVisibility() {
        if (worldCupSection == null) return;
        if (!"home".equals(currentSlug)) {
            worldCupSection.setVisibility(View.GONE);
            return;
        }
        worldCupSection.setVisibility(
            worldCupAdapter != null && worldCupAdapter.getItemCount() > 0 ? View.VISIBLE : View.GONE);
    }

    private void loadWorldCup() {
        if (!isAdded() || !"home".equals(currentSlug)) return;
        new Thread(() -> {
            try {
                VixApi api = new VixApi(requireContext());
                JSONObject data = api.worldCupBanner();
                if (!isAdded()) return;
                requireActivity().runOnUiThread(() -> applyWorldCup(data));
            } catch (Exception ignored) {
                if (!isAdded()) return;
                requireActivity().runOnUiThread(this::updateWorldCupVisibility);
            }
        }).start();
    }

    private void applyWorldCup(JSONObject data) {
        if (!isAdded() || worldCupSection == null || worldCupAdapter == null) return;
        if (!"home".equals(currentSlug)) {
            worldCupSection.setVisibility(View.GONE);
            return;
        }
        if (data == null || !data.optBoolean("enabled", false)) {
            worldCupSection.setVisibility(View.GONE);
            return;
        }
        if (data.optJSONArray("matches") == null || data.optJSONArray("matches").length() == 0) {
            worldCupSection.setVisibility(View.GONE);
            return;
        }
        worldCupTitle.setText(data.optString("title", "En vivo y próximamente"));
        worldCupLiveDot.setVisibility(data.optBoolean("has_live", false) ? View.VISIBLE : View.GONE);
        worldCupAdapter.setMatches(data.optJSONArray("matches"));
        worldCupSection.setVisibility(View.VISIBLE);
    }

    private void scheduleWorldCupRefresh() {
        worldCupHandler.removeCallbacks(worldCupRefreshRunnable);
        if (isAdded() && "home".equals(currentSlug)) {
            worldCupHandler.postDelayed(worldCupRefreshRunnable, WORLDCUP_REFRESH_MS);
        }
    }

    private void stopWorldCupRefresh() {
        worldCupHandler.removeCallbacks(worldCupRefreshRunnable);
    }

    private void showHeroAt(int index) {
        if (heroSlides.isEmpty()) return;
        heroIndex = index % heroSlides.size();
        CatalogItem item = heroSlides.get(heroIndex);
        heroTitle.setText(item.title != null ? item.title.toUpperCase() : "");
        String img = item.banner != null && !item.banner.isEmpty() ? item.banner
            : (item.backdrop != null && !item.backdrop.isEmpty() ? item.backdrop : item.poster);
        String url = PlayUrls.isPlaceholderPoster(img)
            ? PlayUrls.posterForItem(serverBase, item.title, item.year, item.poster)
            : PlayUrls.poster(serverBase, img);
        MobileImageLoader.poster(requireContext(), heroImg, url);
        MobileImageLoader.prefetch(requireContext(), url);
        rebuildDots(heroSlides.size(), heroIndex);
        MobileTrailerHelper.prefetch(requireContext(), item.trailer);
        if (trailerPlayer != null) trailerPlayer.playTrailer(item.trailer);
    }

    private void rebuildDots(int count, int active) {
        heroDots.removeAllViews();
        if (count <= 1) return;
        for (int i = 0; i < count; i++) {
            View dot = new View(requireContext());
            int w = i == active ? MobileUi.dp(requireContext(), 18) : MobileUi.dp(requireContext(), 8);
            int h = MobileUi.dp(requireContext(), 8);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(w, h);
            if (i > 0) lp.setMarginStart(MobileUi.dp(requireContext(), 5));
            dot.setLayoutParams(lp);
            dot.setBackgroundResource(i == active ? R.drawable.mobile_btn_accent : R.drawable.mobile_chip_inactive);
            heroDots.addView(dot);
        }
    }

    private void advanceHero() {
        if (heroSlides.size() < 2) return;
        int next = heroIndex;
        while (next == heroIndex) {
            next = heroRandom.nextInt(heroSlides.size());
        }
        showHeroAt(next);
        startHeroRotation();
    }

    private void startHeroRotation() {
        stopHeroRotation();
        if (heroSlides.size() >= 2) heroHandler.postDelayed(heroRunnable, HERO_ROTATE_MS);
    }

    private void stopHeroRotation() {
        heroHandler.removeCallbacks(heroRunnable);
    }

    private void openCurrentHero() {
        if (!heroSlides.isEmpty()) CatalogNavigator.open(requireContext(), heroSlides.get(heroIndex));
    }

    @Override
    public void onPause() {
        if (!isHidden()) stopHeroRotation();
        stopWorldCupRefresh();
        if (trailerPlayer != null) trailerPlayer.pause();
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (!heroSlides.isEmpty()) startHeroRotation();
        if (trailerPlayer != null) trailerPlayer.resume();
        if ("home".equals(currentSlug)) {
            loadWorldCup();
            scheduleWorldCupRefresh();
        }
    }

    @Override
    public void onHiddenChanged(boolean hidden) {
        super.onHiddenChanged(hidden);
        if (hidden) {
            stopHeroRotation();
            stopWorldCupRefresh();
            if (trailerPlayer != null) trailerPlayer.pause();
        } else {
            if (!heroSlides.isEmpty()) startHeroRotation();
            if (trailerPlayer != null) trailerPlayer.resume();
            if ("home".equals(currentSlug)) {
                loadWorldCup();
                scheduleWorldCupRefresh();
            }
        }
    }

    @Override
    public void onDestroyView() {
        stopWorldCupRefresh();
        if (trailerPlayer != null) trailerPlayer.destroy();
        trailerPlayer = null;
        super.onDestroyView();
    }
}
