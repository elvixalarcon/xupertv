package tv.vix.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;

public class TvSeriesDetailActivity extends AppCompatActivity {
    public static final String EXTRA_SERIES_ID = "series_id";
    public static final String EXTRA_EXTERNAL_SOURCE = "external_source";
    public static final String EXTRA_EXTERNAL_SLUG = "external_slug";
    public static final String EXTRA_PREVIEW_IMAGE = TvPreviewExtras.EXTRA_PREVIEW_IMAGE;
    public static final String EXTRA_PREFILL_TITLE = TvPreviewExtras.EXTRA_PREFILL_TITLE;

    private int seriesId;
    private String externalSource = "";
    private String externalSlug = "";
    private boolean isExternal;
    private String serverBase = "";
    private final List<EpisodeItem> allEpisodes = new ArrayList<>();
    private final List<EpisodeItem> filteredEpisodes = new ArrayList<>();
    private final List<Integer> seasons = new ArrayList<>();
    private final List<SimilarItem> similar = new ArrayList<>();
    private int selectedSeason = 1;
    private EpisodeAdapter episodeAdapter;
    private SeasonAdapter seasonAdapter;
    private RecyclerView epList;
    private Button continueBtn;
    private final Map<Integer, EpisodeProgress> progressByEpisode = new HashMap<>();
    private EpisodeItem resumeEpisode;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TvPreviewExtras.applyInstantTransition(this);
        setContentView(R.layout.activity_tv_series_detail);
        seriesId = getIntent().getIntExtra(EXTRA_SERIES_ID, 0);
        externalSource = getIntent().getStringExtra(EXTRA_EXTERNAL_SOURCE);
        if (externalSource == null) externalSource = "";
        externalSlug = getIntent().getStringExtra(EXTRA_EXTERNAL_SLUG);
        if (externalSlug == null) externalSlug = "";
        isExternal = !externalSource.isEmpty() && !externalSlug.isEmpty();
        serverBase = ServerUrlHelper.fromPrefs(getSharedPreferences(AppConstants.PREFS, MODE_PRIVATE));
        if (!isExternal && seriesId <= 0) {
            finish();
            return;
        }

        ProgressBar loading = findViewById(R.id.tv_detail_loading);
        continueBtn = findViewById(R.id.tv_detail_continue);
        epList = findViewById(R.id.tv_detail_episodes);
        RecyclerView seasonList = findViewById(R.id.tv_detail_seasons);
        RecyclerView simList = findViewById(R.id.tv_detail_similar);

        continueBtn.setOnClickListener(v -> playResumeEpisode());
        continueBtn.setOnKeyListener((v, c, ev) -> {
            if (ev.getAction() == KeyEvent.ACTION_DOWN && isEnter(c)) {
                playResumeEpisode();
                return true;
            }
            return false;
        });

        epList.setLayoutManager(new LinearLayoutManager(this, LinearLayoutManager.VERTICAL, false));
        epList.setNestedScrollingEnabled(false);
        episodeAdapter = new EpisodeAdapter();
        epList.setAdapter(episodeAdapter);

        seasonList.setLayoutManager(new LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false));
        seasonAdapter = new SeasonAdapter();
        seasonList.setAdapter(seasonAdapter);

        simList.setLayoutManager(new LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false));

        applyInstantPreviewFromIntent();
        loading.setVisibility(View.GONE);
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                VixApi api = new VixApi(this);
                JSONObject json;
                JSONObject seriesProgress = new JSONObject();
                if (isExternal) {
                    json = api.externalSeriesMeta(externalSource, externalSlug);
                } else {
                    json = api.seriesDetail(seriesId);
                    seriesProgress = api.watchSeriesProgress(seriesId);
                }
                List<EpisodeItem> eps = new ArrayList<>();
                if (isExternal) {
                    eps.addAll(parseExternalEpisodes(json));
                } else {
                    JSONArray arr = json.optJSONArray("episodes");
                    if (arr != null) {
                        for (int i = 0; i < arr.length(); i++) {
                            JSONObject ep = arr.getJSONObject(i);
                            eps.add(new EpisodeItem(
                                ep.optInt("id", 0),
                                ep.optInt("season", 1),
                                ep.optInt("episode", i + 1),
                                ep.optString("title", ""),
                                ep.optString("description", ""),
                                ep.optString("poster", ""),
                                ep.optString("video_path", "")
                            ));
                        }
                    }
                }
                List<SimilarItem> sim = new ArrayList<>();
                JSONArray simArr = json.optJSONArray("similar");
                if (simArr != null) {
                    for (int i = 0; i < simArr.length(); i++) {
                        JSONObject s = simArr.getJSONObject(i);
                        if (TvCatalogHelper.isExternalItem(s)) continue;
                        sim.add(new SimilarItem(s.optInt("id", 0), s.optString("title", ""), s.optString("poster", "")));
                    }
                }
                final JSONObject progressJson = seriesProgress;
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    bindDetail(json);
                    allEpisodes.clear();
                    allEpisodes.addAll(eps);
                    if (!isExternal) {
                        loadEpisodeProgress(progressJson);
                    }
                    resumeEpisode = isExternal ? null : findResumeEpisode();
                    buildSeasons();
                    if (resumeEpisode != null) {
                        selectedSeason = resumeEpisode.season;
                    } else if (!seasons.isEmpty()) {
                        selectedSeason = seasons.get(0);
                    }
                    filterEpisodesBySeason();
                    seasonAdapter.notifyDataSetChanged();
                    refreshEpisodeList();
                    bindContinueButton();
                    similar.clear();
                    similar.addAll(sim);
                    simList.setAdapter(new SimilarAdapter());
                    if (continueBtn.getVisibility() == View.VISIBLE) {
                        continueBtn.requestFocus();
                    } else if (!filteredEpisodes.isEmpty()) {
                        epList.requestFocus();
                    }
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
                    finish();
                });
            }
        });
    }

    private void buildSeasons() {
        seasons.clear();
        Set<Integer> set = new LinkedHashSet<>();
        for (EpisodeItem ep : allEpisodes) set.add(ep.season);
        List<Integer> sorted = new ArrayList<>(set);
        Collections.sort(sorted);
        seasons.addAll(sorted);
    }

    private void filterEpisodesBySeason() {
        filteredEpisodes.clear();
        for (EpisodeItem ep : allEpisodes) {
            if (ep.season == selectedSeason) filteredEpisodes.add(ep);
        }
        filteredEpisodes.sort(Comparator.comparingInt(ep -> ep.episode));
    }

    private void refreshEpisodeList() {
        episodeAdapter.notifyDataSetChanged();
        if (epList != null) {
            epList.post(() -> TvUiHelper.expandRecyclerViewHeight(epList));
        }
    }

    private void applyInstantPreviewFromIntent() {
        String title = getIntent().getStringExtra(EXTRA_PREFILL_TITLE);
        if (title != null && !title.isEmpty()) {
            TextView titleView = findViewById(R.id.tv_detail_title);
            if (titleView != null) titleView.setText(title);
        }
        String preview = getIntent().getStringExtra(EXTRA_PREVIEW_IMAGE);
        if (preview == null || preview.isEmpty()) return;
        ImageView backdrop = findViewById(R.id.tv_detail_backdrop);
        if (backdrop != null) {
            backdrop.setAlpha(0.62f);
            loadImg(backdrop, preview);
        }
        loadImg(findViewById(R.id.tv_detail_poster), preview);
    }

    private void bindDetail(JSONObject json) {
        ((TextView) findViewById(R.id.tv_detail_title)).setText(json.optString("title", ""));
        String meta = json.optInt("year", 0) > 0 ? String.valueOf(json.optInt("year")) : "";
        int epCount = json.optInt("episodes_count", allEpisodes.size());
        if (epCount > 0) meta += (meta.isEmpty() ? "" : " · ") + epCount + " eps.";
        if (!json.optString("genre", "").isEmpty()) {
            meta += (meta.isEmpty() ? "" : " · ") + json.optString("genre");
        }
        ((TextView) findViewById(R.id.tv_detail_meta)).setText(meta);
        String desc = json.optString("synopsis", "");
        if (desc.isEmpty()) desc = json.optString("description", "");
        ((TextView) findViewById(R.id.tv_detail_synopsis)).setText(desc);
        loadImg(findViewById(R.id.tv_detail_poster), json.optString("poster", ""));
        ImageView backdrop = findViewById(R.id.tv_detail_backdrop);
        String back = json.optString("backdrop", json.optString("poster", ""));
        if (backdrop != null && !back.isEmpty()) {
            backdrop.setAlpha(0.62f);
            loadImg(backdrop, back);
        }
    }

    private void loadImg(ImageView iv, String path) {
        String url = PlayUrls.poster(serverBase, path);
        if (!url.isEmpty()) Glide.with(this).load(url).centerCrop().into(iv);
    }

    private void loadEpisodeProgress(JSONObject seriesProgress) {
        progressByEpisode.clear();
        JSONObject episodes = seriesProgress != null ? seriesProgress.optJSONObject("episodes") : null;
        if (episodes == null) return;
        java.util.Iterator<String> keys = episodes.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            JSONObject row = episodes.optJSONObject(key);
            if (row == null) continue;
            try {
                int epId = Integer.parseInt(key);
                progressByEpisode.put(epId, new EpisodeProgress(
                    (long) row.optDouble("progress", 0),
                    (long) row.optDouble("duration", 0),
                    row.optInt("percent", 0),
                    row.optString("updated_at", "")
                ));
            } catch (NumberFormatException ignored) {}
        }
    }

    private EpisodeItem findResumeEpisode() {
        EpisodeItem best = null;
        String bestUpdated = "";
        for (EpisodeItem ep : allEpisodes) {
            EpisodeProgress prog = progressByEpisode.get(ep.id);
            if (prog == null || prog.progressSec < 30) continue;
            if (prog.durationSec > 0 && prog.progressSec >= prog.durationSec * 0.92) continue;
            if (best == null || prog.updatedAt.compareTo(bestUpdated) > 0) {
                best = ep;
                bestUpdated = prog.updatedAt;
            }
        }
        if (best != null) return best;
        for (EpisodeItem ep : allEpisodes) {
            if (ep.videoPath != null && !ep.videoPath.isEmpty()) return ep;
        }
        return null;
    }

    private void bindContinueButton() {
        if (continueBtn == null) return;
        if (resumeEpisode == null || resumeEpisode.videoPath == null || resumeEpisode.videoPath.isEmpty()) {
            continueBtn.setVisibility(View.GONE);
            return;
        }
        continueBtn.setVisibility(View.VISIBLE);
        EpisodeProgress prog = progressByEpisode.get(resumeEpisode.id);
        String label = "T" + resumeEpisode.season + "E" + String.format("%02d", resumeEpisode.episode);
        if (prog != null && prog.progressSec >= 30 && prog.durationSec > 0 && prog.progressSec < prog.durationSec * 0.92) {
            continueBtn.setText("▶ Continuar " + label + " · " + prog.percent + "%");
        } else {
            String title = resumeEpisode.title != null && !resumeEpisode.title.isEmpty()
                ? resumeEpisode.title : ("Episodio " + resumeEpisode.episode);
            continueBtn.setText("▶ Reproducir " + label + " · " + title);
        }
    }

    private void playResumeEpisode() {
        if (resumeEpisode != null) playEpisode(resumeEpisode, true);
    }

    private void playEpisode(EpisodeItem ep) {
        playEpisode(ep, false);
    }

    private void playEpisode(EpisodeItem ep, boolean preferResume) {
        if (isExternal) {
            playExternalEpisode(ep);
            return;
        }
        if (ep.videoPath == null || ep.videoPath.isEmpty()) {
            Toast.makeText(this, "Episodio no disponible", Toast.LENGTH_LONG).show();
            return;
        }
        Intent i = new Intent(this, TvPlayerActivity.class);
        i.putExtra(TvPlayerActivity.EXTRA_TITLE, ep.title);
        i.putExtra(TvPlayerActivity.EXTRA_VIDEO_PATH, ep.videoPath);
        i.putExtra(TvPlayerActivity.EXTRA_CONTENT_TYPE, "episode");
        i.putExtra(TvPlayerActivity.EXTRA_CONTENT_ID, ep.id);
        i.putExtra(TvPlayerActivity.EXTRA_SERIES_ID, seriesId);
        if (preferResume) {
            EpisodeProgress prog = progressByEpisode.get(ep.id);
            if (prog != null && prog.progressSec >= 30) {
                i.putExtra(TvPlayerActivity.EXTRA_START_SEC, prog.progressSec);
            }
        } else {
            EpisodeProgress prog = progressByEpisode.get(ep.id);
            if (prog != null && prog.progressSec >= 30
                && prog.durationSec > 0 && prog.progressSec < prog.durationSec * 0.92) {
                i.putExtra(TvPlayerActivity.EXTRA_START_SEC, prog.progressSec);
            }
        }
        startActivity(i);
    }

    private void playExternalEpisode(EpisodeItem ep) {
        Toast.makeText(this, "Cargando episodio…", Toast.LENGTH_SHORT).show();
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                VixApi api = new VixApi(this);
                JSONObject play = api.externalSeriesPlay(externalSource, externalSlug, ep.season, ep.episode, "1080");
                String path = TvCatalogHelper.externalPlayUrl(serverBase, play);
                if (path == null || path.isEmpty()) {
                    throw new Exception("Episodio no disponible");
                }
                final String videoPath = path;
                runOnUiThread(() -> {
                    Intent i = new Intent(this, TvPlayerActivity.class);
                    i.putExtra(TvPlayerActivity.EXTRA_TITLE, ep.title);
                    i.putExtra(TvPlayerActivity.EXTRA_VIDEO_PATH, videoPath);
                    i.putExtra(TvPlayerActivity.EXTRA_CONTENT_TYPE, "episode");
                    startActivity(i);
                });
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show());
            }
        });
    }

    private List<EpisodeItem> parseExternalEpisodes(JSONObject json) throws org.json.JSONException {
        List<EpisodeItem> eps = new ArrayList<>();
        JSONArray seasons = json.optJSONArray("seasons");
        if (seasons != null) {
            for (int s = 0; s < seasons.length(); s++) {
                JSONObject seasonBlock = seasons.optJSONObject(s);
                if (seasonBlock == null) continue;
                int defaultSeason = seasonBlock.optInt("season", s + 1);
                JSONArray epArr = seasonBlock.optJSONArray("episodes");
                if (epArr == null) continue;
                for (int e = 0; e < epArr.length(); e++) {
                    JSONObject ep = epArr.getJSONObject(e);
                    int season = ep.optInt("season", defaultSeason);
                    int episode = ep.optInt("episode", e + 1);
                    int id = season * 10000 + episode;
                    eps.add(new EpisodeItem(
                        id,
                        season,
                        episode,
                        ep.optString("title", "Episodio " + episode),
                        ep.optString("overview", ep.optString("description", "")),
                        ep.optString("poster", json.optString("poster", "")),
                        ""
                    ));
                }
            }
        }
        JSONArray flat = json.optJSONArray("episodes");
        if (flat != null) {
            for (int i = 0; i < flat.length(); i++) {
                JSONObject ep = flat.getJSONObject(i);
                int season = ep.optInt("season", 1);
                int episode = ep.optInt("episode", i + 1);
                int id = season * 10000 + episode;
                eps.add(new EpisodeItem(
                    id,
                    season,
                    episode,
                    ep.optString("title", "Episodio " + episode),
                    ep.optString("overview", ep.optString("description", "")),
                    ep.optString("poster", json.optString("poster", "")),
                    ""
                ));
            }
        }
        return eps;
    }

    private boolean isEnter(int code) {
        return code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_BUTTON_A;
    }

    private static class EpisodeProgress {
        final long progressSec;
        final long durationSec;
        final int percent;
        final String updatedAt;

        EpisodeProgress(long progressSec, long durationSec, int percent, String updatedAt) {
            this.progressSec = progressSec;
            this.durationSec = durationSec;
            this.percent = percent;
            this.updatedAt = updatedAt != null ? updatedAt : "";
        }
    }

    private static class EpisodeItem {
        final int id, season, episode;
        final String title, description, poster, videoPath;

        EpisodeItem(int id, int season, int episode, String title, String description, String poster, String videoPath) {
            this.id = id;
            this.season = season;
            this.episode = episode;
            this.title = title;
            this.description = description;
            this.poster = poster;
            this.videoPath = videoPath;
        }
    }

    private static class SimilarItem {
        final int id;
        final String title, poster;

        SimilarItem(int id, String title, String poster) {
            this.id = id;
            this.title = title;
            this.poster = poster;
        }
    }

    private class SeasonAdapter extends RecyclerView.Adapter<SeasonAdapter.H> {
        @NonNull
        @Override
        public H onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            TextView tv = new TextView(parent.getContext());
            int pad = (int) (12 * getResources().getDisplayMetrics().density);
            tv.setPadding(pad, pad / 2, pad, pad / 2);
            tv.setLayoutParams(new RecyclerView.LayoutParams(
                RecyclerView.LayoutParams.WRAP_CONTENT,
                RecyclerView.LayoutParams.WRAP_CONTENT));
            tv.setFocusable(true);
            tv.setBackgroundResource(R.drawable.tv_poster_selector);
            tv.setTextColor(ContextCompat.getColor(TvSeriesDetailActivity.this, R.color.tv_text));
            tv.setTextSize(13);
            return new H(tv);
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            int season = seasons.get(position);
            holder.tv.setText("Temporada " + season);
            boolean sel = season == selectedSeason;
            holder.tv.setTextColor(ContextCompat.getColor(TvSeriesDetailActivity.this,
                sel ? R.color.tv_gold : R.color.tv_text_dim));
            holder.tv.setOnClickListener(v -> {
                selectedSeason = season;
                filterEpisodesBySeason();
                notifyDataSetChanged();
                refreshEpisodeList();
            });
            holder.tv.setOnFocusChangeListener((v, has) -> TvFocusAnim.applySeasonChip(v, has));
            holder.tv.setOnKeyListener((v, c, ev) -> {
                if (ev.getAction() == KeyEvent.ACTION_DOWN && isEnter(c)) {
                    selectedSeason = season;
                    filterEpisodesBySeason();
                    notifyDataSetChanged();
                    refreshEpisodeList();
                    return true;
                }
                return false;
            });
        }

        @Override
        public int getItemCount() { return seasons.size(); }

        class H extends RecyclerView.ViewHolder {
            final TextView tv;
            H(TextView tv) {
                super(tv);
                this.tv = tv;
            }
        }
    }

    private class EpisodeAdapter extends RecyclerView.Adapter<EpisodeAdapter.H> {
        @NonNull
        @Override
        public H onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            return new H(getLayoutInflater().inflate(R.layout.item_tv_episode_row, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            EpisodeItem ep = filteredEpisodes.get(position);
            holder.badge.setText("T" + ep.season + "E" + String.format("%02d", ep.episode));
            String title = ep.title != null && !ep.title.isEmpty() ? ep.title : ("Episodio " + ep.episode);
            holder.title.setText(title);
            holder.sub.setText("Episodio " + ep.episode);
            holder.desc.setText(ep.description != null ? ep.description : "");
            String thumb = ep.poster != null && !ep.poster.isEmpty() ? ep.poster : "";
            loadImg(holder.thumb, thumb);
            EpisodeProgress prog = progressByEpisode.get(ep.id);
            if (prog != null && prog.percent > 0 && prog.percent < 92) {
                holder.progress.setVisibility(View.VISIBLE);
                android.view.ViewGroup.LayoutParams lp = holder.progress.getLayoutParams();
                lp.width = (int) (holder.thumb.getLayoutParams().width * (prog.percent / 100f));
                holder.progress.setLayoutParams(lp);
                holder.sub.setText("Visto " + prog.percent + "%");
            } else {
                holder.progress.setVisibility(View.GONE);
                holder.sub.setText("Episodio " + ep.episode);
            }
            boolean isResume = resumeEpisode != null && resumeEpisode.id == ep.id;
            holder.itemView.setAlpha(isResume ? 1f : 0.92f);
            holder.itemView.setOnFocusChangeListener((v, has) -> TvFocusAnim.applyEpisodeRow(v, has));
            holder.itemView.setOnClickListener(v -> playEpisode(ep));
            holder.itemView.setOnKeyListener((v, c, ev) -> {
                if (ev.getAction() == KeyEvent.ACTION_DOWN && isEnter(c)) {
                    playEpisode(ep);
                    return true;
                }
                return false;
            });
        }

        @Override
        public int getItemCount() { return filteredEpisodes.size(); }

        class H extends RecyclerView.ViewHolder {
            final ImageView thumb;
            final TextView badge, title, sub, desc;
            final View progress;

            H(View v) {
                super(v);
                thumb = v.findViewById(R.id.tv_ep_thumb);
                badge = v.findViewById(R.id.tv_ep_badge);
                title = v.findViewById(R.id.tv_ep_title);
                sub = v.findViewById(R.id.tv_ep_sub);
                desc = v.findViewById(R.id.tv_ep_desc);
                progress = v.findViewById(R.id.tv_ep_progress);
            }
        }
    }

    private class SimilarAdapter extends RecyclerView.Adapter<SimilarAdapter.H> {
        @NonNull
        @Override
        public H onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            return new H(getLayoutInflater().inflate(R.layout.item_tv_poster, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            SimilarItem item = similar.get(position);
            holder.title.setText(item.title);
            loadImg(holder.image, item.poster);
            holder.itemView.setOnFocusChangeListener((v, has) -> TvFocusAnim.applyPoster(v, has));
            holder.itemView.setOnClickListener(v -> {
                Intent i = new Intent(TvSeriesDetailActivity.this, TvSeriesDetailActivity.class);
                i.putExtra(EXTRA_SERIES_ID, item.id);
                startActivity(i);
            });
        }

        @Override
        public int getItemCount() { return similar.size(); }

        class H extends RecyclerView.ViewHolder {
            final ImageView image;
            final TextView title;

            H(View v) {
                super(v);
                image = v.findViewById(R.id.tv_poster_img);
                title = v.findViewById(R.id.tv_poster_title);
            }
        }
    }
}
