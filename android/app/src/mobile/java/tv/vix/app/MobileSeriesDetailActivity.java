package tv.vix.app;

import android.content.Intent;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

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

public class MobileSeriesDetailActivity extends AppCompatActivity {
    private int seriesId;
    private String externalSource = "";
    private String externalSlug = "";
    private boolean isExternal;
    private String serverBase = "";
    private String trailerKey = "";

    private final List<EpisodeItem> allEpisodes = new ArrayList<>();
    private final List<EpisodeItem> filteredEpisodes = new ArrayList<>();
    private final List<Integer> seasons = new ArrayList<>();
    private final List<SimilarItem> similar = new ArrayList<>();
    private final Map<Integer, EpisodeProgress> progressByEpisode = new HashMap<>();
    private int selectedSeason = 1;
    private EpisodeItem resumeEpisode;
    private EpisodeAdapter episodeAdapter;
    private SeasonAdapter seasonAdapter;

    private ExoPlayer trailerPlayer;
    private PlayerView trailerView;
    private ImageButton muteButton;
    private boolean trailerMuted = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TvPreviewExtras.applyInstantTransition(this);
        setContentView(R.layout.activity_mobile_series_detail);

        seriesId = getIntent().getIntExtra(TvSeriesDetailActivity.EXTRA_SERIES_ID, 0);
        externalSource = nullToEmpty(getIntent().getStringExtra(TvSeriesDetailActivity.EXTRA_EXTERNAL_SOURCE));
        externalSlug = nullToEmpty(getIntent().getStringExtra(TvSeriesDetailActivity.EXTRA_EXTERNAL_SLUG));
        isExternal = !externalSource.isEmpty() && !externalSlug.isEmpty();
        serverBase = ServerUrlHelper.fromPrefs(getSharedPreferences(AppConstants.PREFS, MODE_PRIVATE));

        if (!isExternal && seriesId <= 0) {
            finish();
            return;
        }

        trailerView = findViewById(R.id.mobile_detail_trailer);
        muteButton = findViewById(R.id.mobile_detail_mute);
        ProgressBar loading = findViewById(R.id.mobile_detail_loading);
        Button playBtn = findViewById(R.id.mobile_detail_play);
        Button trailerBtn = findViewById(R.id.mobile_detail_trailer_btn);
        RecyclerView epList = findViewById(R.id.mobile_detail_episodes);
        RecyclerView seasonList = findViewById(R.id.mobile_detail_seasons);
        RecyclerView simList = findViewById(R.id.mobile_detail_similar);

        findViewById(R.id.mobile_detail_back).setOnClickListener(v -> finish());
        playBtn.setOnClickListener(v -> playResumeEpisode());
        trailerBtn.setOnClickListener(v -> showTrailerDialog());
        muteButton.setOnClickListener(v -> toggleTrailerMute());

        epList.setLayoutManager(new LinearLayoutManager(this));
        epList.setNestedScrollingEnabled(false);
        episodeAdapter = new EpisodeAdapter();
        epList.setAdapter(episodeAdapter);

        seasonList.setLayoutManager(new LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false));
        seasonAdapter = new SeasonAdapter();
        seasonList.setAdapter(seasonAdapter);

        simList.setLayoutManager(new LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false));

        applyInstantPreview();
        loadDetail(loading, simList);
    }

    private void loadDetail(ProgressBar loading, RecyclerView simList) {
        JSONObject cached = isExternal
            ? MobileContentCache.getExternalSeries(externalSource, externalSlug)
            : MobileContentCache.getSeriesDetail(seriesId);
        if (cached != null) {
            loading.setVisibility(View.GONE);
            applySeriesData(cached, simList, new JSONObject());
            if (!isExternal) reloadSeriesProgress();
            return;
        }
        loading.setVisibility(View.VISIBLE);
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                VixApi api = new VixApi(this);
                JSONObject json;
                JSONObject seriesProgress = new JSONObject();
                if (isExternal) {
                    json = api.externalSeriesMeta(externalSource, externalSlug);
                    MobileContentCache.putExternalSeries(externalSource, externalSlug, json);
                } else {
                    json = api.seriesDetail(seriesId);
                    MobileContentCache.putSeriesDetail(seriesId, json);
                    seriesProgress = api.watchSeriesProgress(seriesId);
                }
                List<SimilarItem> sim = parseSimilar(json);
                final JSONObject progressJson = seriesProgress;
                final JSONObject fj = json;
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    applySeriesData(fj, simList, progressJson);
                    similar.clear();
                    similar.addAll(sim);
                    simList.setAdapter(new SimilarAdapter());
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
                    finish();
                });
            }
        });
    }

    private void applySeriesData(JSONObject json, RecyclerView simList, JSONObject seriesProgress) {
        bindDetail(json);
        allEpisodes.clear();
        try {
            allEpisodes.addAll(parseEpisodes(json));
        } catch (org.json.JSONException ignored) { }
        if (!isExternal) loadEpisodeProgress(seriesProgress);
        resumeEpisode = isExternal ? null : findResumeEpisode();
        buildSeasons();
        if (resumeEpisode != null) {
            selectedSeason = resumeEpisode.season;
        } else if (!seasons.isEmpty()) {
            selectedSeason = seasons.get(0);
        }
        filterEpisodesBySeason();
        seasonAdapter.notifyDataSetChanged();
        episodeAdapter.notifyDataSetChanged();
        bindPlayButton();
        if (simList.getAdapter() == null) {
            similar.clear();
            similar.addAll(parseSimilar(json));
            simList.setAdapter(new SimilarAdapter());
        }
        setupTrailer(json);
    }

    private void reloadSeriesProgress() {
        if (isExternal || seriesId <= 0) return;
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                JSONObject progressJson = new VixApi(this).watchSeriesProgress(seriesId);
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    loadEpisodeProgress(progressJson);
                    resumeEpisode = findResumeEpisode();
                    bindPlayButton();
                    episodeAdapter.notifyDataSetChanged();
                });
            } catch (Exception ignored) { }
        });
    }

    private void setupTrailer(JSONObject json) {
        trailerKey = json.optString("trailer", "");
        Button trailerBtn = findViewById(R.id.mobile_detail_trailer_btn);
        ImageView backdrop = findViewById(R.id.mobile_detail_backdrop);
        if (trailerKey == null || trailerKey.isEmpty()) {
            trailerBtn.setVisibility(View.GONE);
            return;
        }
        trailerBtn.setVisibility(View.VISIBLE);
        MobileTrailerHelper.prefetch(this, trailerKey);
        MobileTrailerHelper.resolveInfo(this, trailerKey, info -> {
            if (isFinishing() || info == null || info.playUrl == null || info.playUrl.isEmpty()) return;
            MobileTrailerHelper.warmStreamCache(this, info);
            trailerPlayer = MobileTrailerHelper.playInView(
                this, trailerView, muteButton, backdrop, trailerPlayer, info, trailerMuted);
        });
    }

    private void bindPlayButton() {
        Button playBtn = findViewById(R.id.mobile_detail_play);
        if (resumeEpisode == null || resumeEpisode.videoPath == null || resumeEpisode.videoPath.isEmpty()) {
            if (!filteredEpisodes.isEmpty()) {
                EpisodeItem first = filteredEpisodes.get(0);
                playBtn.setText("▶ Reproducir T" + first.season + "E" + String.format("%02d", first.episode));
            } else {
                playBtn.setText(R.string.mobile_detail_play);
            }
            return;
        }
        EpisodeProgress prog = progressByEpisode.get(resumeEpisode.id);
        String label = "T" + resumeEpisode.season + "E" + String.format("%02d", resumeEpisode.episode);
        if (prog != null && prog.progressSec >= 30 && prog.durationSec > 0
            && prog.progressSec < prog.durationSec * 0.92) {
            playBtn.setText("▶ Continuar " + label + " · " + prog.percent + "%");
        } else {
            playBtn.setText("▶ Reproducir " + label);
        }
    }

    private void bindDetail(JSONObject json) {
        ((TextView) findViewById(R.id.mobile_detail_title)).setText(json.optString("title", ""));
        String meta = json.optInt("year", 0) > 0 ? String.valueOf(json.optInt("year")) : "";
        int epCount = json.optInt("episodes_count", allEpisodes.size());
        if (epCount > 0) meta += (meta.isEmpty() ? "" : " · ") + epCount + " eps.";
        if (!json.optString("genre", "").isEmpty()) {
            meta += (meta.isEmpty() ? "" : " · ") + json.optString("genre");
        }
        ((TextView) findViewById(R.id.mobile_detail_meta)).setText(meta);
        String desc = json.optString("synopsis", "");
        if (desc.isEmpty()) desc = json.optString("description", "");
        ((TextView) findViewById(R.id.mobile_detail_synopsis)).setText(desc);
        loadImg(findViewById(R.id.mobile_detail_poster), json.optString("poster", ""));
        String back = json.optString("backdrop", json.optString("poster", ""));
        loadBackdrop(findViewById(R.id.mobile_detail_backdrop), back);
    }

    private void applyInstantPreview() {
        String title = getIntent().getStringExtra(TvSeriesDetailActivity.EXTRA_PREFILL_TITLE);
        if (title != null && !title.isEmpty()) {
            TextView titleView = findViewById(R.id.mobile_detail_title);
            if (titleView != null) titleView.setText(title);
        }
        String preview = getIntent().getStringExtra(TvSeriesDetailActivity.EXTRA_PREVIEW_IMAGE);
        if (preview == null || preview.isEmpty()) return;
        loadImg(findViewById(R.id.mobile_detail_poster), preview);
        loadBackdrop(findViewById(R.id.mobile_detail_backdrop), preview);
    }

    private List<EpisodeItem> parseEpisodes(JSONObject json) throws org.json.JSONException {
        List<EpisodeItem> eps = new ArrayList<>();
        if (isExternal) {
            JSONArray seasonsArr = json.optJSONArray("seasons");
            if (seasonsArr != null) {
                for (int s = 0; s < seasonsArr.length(); s++) {
                    JSONObject seasonBlock = seasonsArr.optJSONObject(s);
                    if (seasonBlock == null) continue;
                    int defaultSeason = seasonBlock.optInt("season", s + 1);
                    JSONArray epArr = seasonBlock.optJSONArray("episodes");
                    if (epArr == null) continue;
                    for (int e = 0; e < epArr.length(); e++) {
                        JSONObject ep = epArr.getJSONObject(e);
                        int season = ep.optInt("season", defaultSeason);
                        int episode = ep.optInt("episode", e + 1);
                        eps.add(new EpisodeItem(
                            season * 10000 + episode, season, episode,
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
                    eps.add(new EpisodeItem(
                        season * 10000 + episode, season, episode,
                        ep.optString("title", "Episodio " + episode),
                        ep.optString("overview", ep.optString("description", "")),
                        ep.optString("poster", json.optString("poster", "")),
                        ""
                    ));
                }
            }
            return eps;
        }
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
        return eps;
    }

    private List<SimilarItem> parseSimilar(JSONObject json) {
        List<SimilarItem> sim = new ArrayList<>();
        JSONArray simArr = json.optJSONArray("similar");
        if (simArr == null) return sim;
        for (int i = 0; i < simArr.length(); i++) {
            JSONObject s = simArr.optJSONObject(i);
            if (s == null || TvCatalogHelper.isExternalItem(s)) continue;
            sim.add(new SimilarItem(s.optInt("id", 0), s.optString("title", ""), s.optString("poster", "")));
        }
        return sim;
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
            } catch (NumberFormatException ignored) { }
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

    private void playResumeEpisode() {
        if (resumeEpisode != null) {
            playEpisode(resumeEpisode, true);
        } else if (!filteredEpisodes.isEmpty()) {
            playEpisode(filteredEpisodes.get(0), false);
        }
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
        TvPreviewExtras.applyInstantTransition(this);
    }

    private void playExternalEpisode(EpisodeItem ep) {
        Toast.makeText(this, "Cargando episodio…", Toast.LENGTH_SHORT).show();
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                VixApi api = new VixApi(this);
                JSONObject play = api.externalSeriesPlay(externalSource, externalSlug, ep.season, ep.episode, "1080");
                String path = TvCatalogHelper.externalPlayUrl(serverBase, play);
                if (path == null || path.isEmpty()) throw new Exception("Episodio no disponible");
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

    private void showTrailerDialog() {
        if (trailerKey == null || trailerKey.isEmpty()) return;
        View content = LayoutInflater.from(this).inflate(R.layout.dialog_mobile_trailer, null);
        PlayerView pv = content.findViewById(R.id.mobile_trailer_player);
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setView(content)
            .create();
        content.findViewById(R.id.mobile_trailer_close).setOnClickListener(v -> dialog.dismiss());
        dialog.setOnDismissListener(d -> MobileTrailerHelper.stop(null, pv, null));
        dialog.show();
        MobileTrailerHelper.resolveInfo(this, trailerKey, info -> {
            if (dialog.isShowing() && info != null && info.playUrl != null && !info.playUrl.isEmpty()) {
                MobileTrailerHelper.playInView(this, pv, null, null, null, info, false);
            }
        });
    }

    private void toggleTrailerMute() {
        trailerMuted = !trailerMuted;
        if (trailerPlayer != null) trailerPlayer.setVolume(trailerMuted ? 0f : 1f);
        muteButton.setImageResource(trailerMuted
            ? R.drawable.ic_mobile_volume_off : R.drawable.ic_mobile_volume_on);
    }

    private void loadImg(ImageView iv, String path) {
        MobileImageLoader.posterPath(this, iv, serverBase, path);
    }

    private void loadBackdrop(ImageView iv, String path) {
        MobileImageLoader.posterPath(this, iv, serverBase, path);
    }

    @Override
    protected void onPause() {
        if (trailerPlayer != null) trailerPlayer.pause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (trailerPlayer != null) trailerPlayer.play();
    }

    @Override
    protected void onDestroy() {
        MobileTrailerHelper.stop(trailerPlayer, trailerView, muteButton,
            findViewById(R.id.mobile_detail_backdrop));
        trailerPlayer = null;
        super.onDestroy();
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
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

        EpisodeItem(int id, int season, int episode, String title, String description,
                    String poster, String videoPath) {
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
        public H onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            TextView tv = new TextView(parent.getContext());
            int padH = MobileUi.dp(parent.getContext(), 14);
            int padV = MobileUi.dp(parent.getContext(), 8);
            tv.setPadding(padH, padV, padH, padV);
            RecyclerView.LayoutParams lp = new RecyclerView.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMarginEnd(MobileUi.dp(parent.getContext(), 8));
            tv.setLayoutParams(lp);
            tv.setTextSize(13);
            tv.setTypeface(tv.getTypeface(), Typeface.BOLD);
            return new H(tv);
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            int season = seasons.get(position);
            holder.tv.setText("Temporada " + season);
            boolean sel = season == selectedSeason;
            holder.tv.setBackgroundResource(sel
                ? R.drawable.mobile_chip_category_active
                : R.drawable.mobile_poster_bg);
            holder.tv.setTextColor(ContextCompat.getColor(MobileSeriesDetailActivity.this,
                sel ? android.R.color.black : R.color.mobile_text));
            holder.tv.setOnClickListener(v -> {
                selectedSeason = season;
                filterEpisodesBySeason();
                notifyDataSetChanged();
                episodeAdapter.notifyDataSetChanged();
                bindPlayButton();
            });
        }

        @Override
        public int getItemCount() {
            return seasons.size();
        }

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
        public H onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            return new H(getLayoutInflater().inflate(R.layout.item_mobile_episode_row, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            EpisodeItem ep = filteredEpisodes.get(position);
            holder.badge.setText("T" + ep.season + "E" + String.format("%02d", ep.episode));
            String title = ep.title != null && !ep.title.isEmpty() ? ep.title : ("Episodio " + ep.episode);
            holder.title.setText(title);
            holder.desc.setText(ep.description != null ? ep.description : "");
            loadImg(holder.thumb, ep.poster);
            EpisodeProgress prog = progressByEpisode.get(ep.id);
            if (prog != null && prog.percent >= 2 && prog.percent < 92) {
                holder.progressTrack.setVisibility(View.VISIBLE);
                ViewGroup.LayoutParams lp = holder.progressFill.getLayoutParams();
                int trackW = MobileUi.dp(holder.itemView.getContext(), 112);
                lp.width = (int) (trackW * (prog.percent / 100f));
                holder.progressFill.setLayoutParams(lp);
                holder.sub.setText("Visto " + prog.percent + "%");
            } else {
                holder.progressTrack.setVisibility(View.GONE);
                holder.sub.setText("Episodio " + ep.episode);
            }
            holder.itemView.setOnClickListener(v -> playEpisode(ep, false));
        }

        @Override
        public int getItemCount() {
            return filteredEpisodes.size();
        }

        class H extends RecyclerView.ViewHolder {
            final ImageView thumb;
            final TextView badge, title, sub, desc;
            final FrameLayout progressTrack;
            final View progressFill;

            H(View v) {
                super(v);
                thumb = v.findViewById(R.id.mobile_ep_thumb);
                badge = v.findViewById(R.id.mobile_ep_badge);
                title = v.findViewById(R.id.mobile_ep_title);
                sub = v.findViewById(R.id.mobile_ep_sub);
                desc = v.findViewById(R.id.mobile_ep_desc);
                progressTrack = v.findViewById(R.id.mobile_ep_progress_track);
                progressFill = v.findViewById(R.id.mobile_ep_progress_fill);
            }
        }
    }

    private class SimilarAdapter extends RecyclerView.Adapter<SimilarAdapter.H> {
        @NonNull
        @Override
        public H onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            return new H(getLayoutInflater().inflate(R.layout.item_mobile_poster, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            SimilarItem item = similar.get(position);
            holder.title.setText(item.title);
            loadImg(holder.image, item.poster);
            holder.rating.setVisibility(View.GONE);
            holder.itemView.setOnClickListener(v -> {
                Intent i = VixDetailRoutes.seriesDetailIntent(MobileSeriesDetailActivity.this, item.id);
                startActivity(i);
                finish();
            });
        }

        @Override
        public int getItemCount() {
            return similar.size();
        }

        class H extends RecyclerView.ViewHolder {
            final ImageView image;
            final TextView title;
            final TextView rating;

            H(View v) {
                super(v);
                image = v.findViewById(R.id.mobile_poster_img);
                title = v.findViewById(R.id.mobile_poster_title);
                rating = v.findViewById(R.id.mobile_poster_rating);
            }
        }
    }
}
