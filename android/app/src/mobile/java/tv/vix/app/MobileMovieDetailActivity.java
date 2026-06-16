package tv.vix.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MobileMovieDetailActivity extends AppCompatActivity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private int movieId;
    private String externalSource = "";
    private String externalSlug = "";
    private int externalYear;
    private boolean isExternal;
    private String serverBase = "";
    private String authToken = "";
    private JSONObject detail;
    private final List<SimilarItem> similar = new ArrayList<>();
    private String previewImageUrl = "";
    private String trailerKey = "";
    private long savedProgressSec;
    private long watchDurationSec;

    private ExoPlayer trailerPlayer;
    private PlayerView trailerView;
    private ImageButton muteButton;
    private boolean trailerMuted = true;
    private ActivityResultLauncher<Intent> playerLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TvPreviewExtras.applyInstantTransition(this);
        setContentView(R.layout.activity_mobile_movie_detail);

        movieId = getIntent().getIntExtra(TvMovieDetailActivity.EXTRA_MOVIE_ID, 0);
        externalSource = nullToEmpty(getIntent().getStringExtra(TvMovieDetailActivity.EXTRA_EXTERNAL_SOURCE));
        externalSlug = nullToEmpty(getIntent().getStringExtra(TvMovieDetailActivity.EXTRA_EXTERNAL_SLUG));
        externalYear = getIntent().getIntExtra(TvMovieDetailActivity.EXTRA_EXTERNAL_YEAR, 0);
        isExternal = !externalSource.isEmpty() && !externalSlug.isEmpty();
        previewImageUrl = nullToEmpty(getIntent().getStringExtra(TvMovieDetailActivity.EXTRA_PREVIEW_IMAGE));
        serverBase = ServerUrlHelper.fromPrefs(getSharedPreferences(AppConstants.PREFS, MODE_PRIVATE));
        authToken = NativeAuth.getToken(this);

        if (!isExternal && movieId <= 0) {
            finish();
            return;
        }

        trailerView = findViewById(R.id.mobile_detail_trailer);
        muteButton = findViewById(R.id.mobile_detail_mute);
        ProgressBar loading = findViewById(R.id.mobile_detail_loading);
        Button playBtn = findViewById(R.id.mobile_detail_play);
        Button trailerBtn = findViewById(R.id.mobile_detail_trailer_btn);

        findViewById(R.id.mobile_detail_back).setOnClickListener(v -> finish());
        playBtn.setOnClickListener(v -> openPlayer());
        trailerBtn.setOnClickListener(v -> showTrailerDialog());
        muteButton.setOnClickListener(v -> toggleTrailerMute());

        RecyclerView similarList = findViewById(R.id.mobile_detail_similar);
        similarList.setLayoutManager(new LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false));

        playerLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                reloadProgress();
                MobileContentCache.invalidateProfile(MobileMovieDetailActivity.this);
            }
        );

        applyInstantPreview();
        loadDetail(loading, similarList);
    }

    private void loadDetail(ProgressBar loading, RecyclerView similarList) {
        JSONObject cached = isExternal
            ? MobileContentCache.getExternalMovie(externalSource, externalSlug)
            : MobileContentCache.getMovieDetail(movieId);
        if (cached != null) {
            loading.setVisibility(View.GONE);
            applyMovieData(cached, similarList);
            if (!isExternal) reloadProgress();
            return;
        }
        loading.setVisibility(View.VISIBLE);
        executor.execute(() -> {
            try {
                VixApi api = new VixApi(this);
                JSONObject json;
                long prog = 0;
                long dur = 0;
                if (isExternal) {
                    Integer year = externalYear > 0 ? externalYear : null;
                    json = api.externalMovieMeta(externalSource, externalSlug, year);
                    MobileContentCache.putExternalMovie(externalSource, externalSlug, json);
                } else {
                    json = api.movieDetail(movieId);
                    MobileContentCache.putMovieDetail(movieId, json);
                    JSONObject wh = api.watchProgress("movie", movieId);
                    prog = (long) wh.optDouble("progress", 0);
                    dur = (long) wh.optDouble("duration", 0);
                }
                List<SimilarItem> sim = parseSimilar(json);
                final long fProg = prog;
                final long fDur = dur;
                final JSONObject fj = json;
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    savedProgressSec = fProg;
                    watchDurationSec = fDur;
                    applyMovieData(fj, similarList);
                    similar.clear();
                    similar.addAll(sim);
                    similarList.setAdapter(new SimilarAdapter());
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

    private void applyMovieData(JSONObject json, RecyclerView similarList) {
        detail = json;
        if (!isExternal && watchDurationSec <= 0) {
            int runtime = json.optInt("runtime", 0);
            if (runtime > 0) watchDurationSec = runtime * 60L;
        }
        bindDetail(json);
        bindPlayButton();
        if (similarList.getAdapter() == null) {
            similar.clear();
            similar.addAll(parseSimilar(json));
            similarList.setAdapter(new SimilarAdapter());
        }
        setupTrailer(json);
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
        if (savedProgressSec >= 30 && watchDurationSec > 0
            && savedProgressSec < watchDurationSec * 0.92) {
            int pct = (int) Math.min(99, (savedProgressSec * 100L) / watchDurationSec);
            playBtn.setText(getString(R.string.mobile_detail_continue) + " · " + pct + "%");
        } else {
            playBtn.setText(R.string.mobile_detail_play);
        }
    }

    private void bindDetail(JSONObject json) {
        TextView title = findViewById(R.id.mobile_detail_title);
        TextView rating = findViewById(R.id.mobile_detail_rating);
        TextView meta = findViewById(R.id.mobile_detail_meta);
        TextView genres = findViewById(R.id.mobile_detail_genres);
        TextView synopsis = findViewById(R.id.mobile_detail_synopsis);
        ImageView backdrop = findViewById(R.id.mobile_detail_backdrop);
        ImageView poster = findViewById(R.id.mobile_detail_poster);

        title.setText(json.optString("title", ""));
        double r = json.optDouble("rating", 0);
        if (r > 0) {
            rating.setVisibility(View.VISIBLE);
            rating.setText(String.format(Locale.US, "%.1f", r));
        } else {
            rating.setVisibility(View.GONE);
        }

        String year = json.optInt("year", 0) > 0 ? String.valueOf(json.optInt("year")) : "";
        int runtime = json.optInt("runtime", 0);
        String runtimeStr = runtime > 0 ? runtime + " min" : "";
        meta.setText(join(" · ", year, runtimeStr));

        JSONArray gArr = json.optJSONArray("genres");
        String genre = json.optString("genre", "");
        if (gArr != null && gArr.length() > 0) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < gArr.length(); i++) {
                if (i > 0) sb.append(" · ");
                sb.append(gArr.optString(i));
            }
            genres.setText(sb.toString());
        } else {
            genres.setText(genre);
        }

        String desc = json.optString("synopsis", "");
        if (desc.isEmpty()) desc = json.optString("description", "");
        synopsis.setText(desc);

        String posterUrl = json.optString("poster", "");
        String back = json.optString("backdrop", posterUrl);
        String banner = json.optString("banner", "");
        previewImageUrl = TvPreviewExtras.pickImage(banner, back, posterUrl);
        loadImg(poster, posterUrl.isEmpty() ? previewImageUrl : posterUrl);
        loadBackdrop(backdrop, back.isEmpty() ? previewImageUrl : back);
    }

    private void applyInstantPreview() {
        String title = getIntent().getStringExtra(TvMovieDetailActivity.EXTRA_PREFILL_TITLE);
        if (title != null && !title.isEmpty()) {
            TextView titleView = findViewById(R.id.mobile_detail_title);
            if (titleView != null) titleView.setText(title);
        }
        if (previewImageUrl.isEmpty()) return;
        loadImg(findViewById(R.id.mobile_detail_poster), previewImageUrl);
        loadBackdrop(findViewById(R.id.mobile_detail_backdrop), previewImageUrl);
    }

    private void openPlayer() {
        if (detail == null) return;
        if (isExternal) {
            openExternalPlayer();
            return;
        }
        String path = detail.optString("video_path", "");
        if (path.isEmpty()) {
            Toast.makeText(this, "Video no disponible", Toast.LENGTH_LONG).show();
            return;
        }
        long startMs = savedProgressSec > 0 ? savedProgressSec * 1000L : 0;
        Intent i = new Intent(this, TvPlayerActivity.class);
        i.putExtra(TvPlayerActivity.EXTRA_TITLE, detail.optString("title", ""));
        i.putExtra(TvPlayerActivity.EXTRA_VIDEO_PATH, path);
        i.putExtra(TvPlayerActivity.EXTRA_START_MS, startMs);
        i.putExtra(TvPlayerActivity.EXTRA_START_SEC, savedProgressSec);
        i.putExtra(TvPlayerActivity.EXTRA_CONTENT_TYPE, "movie");
        i.putExtra(TvPlayerActivity.EXTRA_CONTENT_ID, movieId);
        if (!previewImageUrl.isEmpty()) {
            i.putExtra(TvPlayerActivity.EXTRA_PREVIEW_IMAGE, previewImageUrl);
        }
        playerLauncher.launch(i);
        TvPreviewExtras.applyInstantTransition(this);
    }

    private void openExternalPlayer() {
        Button playBtn = findViewById(R.id.mobile_detail_play);
        playBtn.setEnabled(false);
        executor.execute(() -> {
            try {
                VixApi api = new VixApi(this);
                int year = externalYear > 0 ? externalYear : detail.optInt("year", 0);
                Integer yearArg = year > 0 ? year : null;
                JSONObject play = api.externalMoviePlay(externalSource, externalSlug, yearArg, "1080");
                String path = TvCatalogHelper.externalPlayUrl(serverBase, play);
                if (path == null || path.isEmpty()) throw new Exception("Video no disponible");
                final String videoPath = path;
                runOnUiThread(() -> {
                    playBtn.setEnabled(true);
                    Intent i = new Intent(this, TvPlayerActivity.class);
                    i.putExtra(TvPlayerActivity.EXTRA_TITLE, detail.optString("title", ""));
                    i.putExtra(TvPlayerActivity.EXTRA_VIDEO_PATH, videoPath);
                    i.putExtra(TvPlayerActivity.EXTRA_CONTENT_TYPE, "movie");
                    if (!previewImageUrl.isEmpty()) {
                        i.putExtra(TvPlayerActivity.EXTRA_PREVIEW_IMAGE, previewImageUrl);
                    }
                    startActivity(i);
                    TvPreviewExtras.applyInstantTransition(this);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    playBtn.setEnabled(true);
                    Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void reloadProgress() {
        if (isExternal || movieId <= 0) return;
        executor.execute(() -> {
            try {
                JSONObject wh = new VixApi(this).watchProgress("movie", movieId);
                long prog = (long) wh.optDouble("progress", 0);
                long dur = (long) wh.optDouble("duration", 0);
                runOnUiThread(() -> {
                    savedProgressSec = prog;
                    if (dur > 0) watchDurationSec = dur;
                    bindPlayButton();
                });
            } catch (Exception ignored) { }
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

    private List<SimilarItem> parseSimilar(JSONObject json) {
        List<SimilarItem> sim = new ArrayList<>();
        JSONArray arr = json.optJSONArray("similar");
        if (arr == null) return sim;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject s = arr.optJSONObject(i);
            if (s == null || TvCatalogHelper.isExternalItem(s)) continue;
            sim.add(new SimilarItem(
                s.optInt("id", 0),
                s.optString("title", ""),
                s.optString("poster", ""),
                TvPosterBind.ratingFromJson(s)
            ));
        }
        return sim;
    }

    private void loadBackdrop(ImageView iv, String path) {
        MobileImageLoader.posterPath(this, iv, serverBase, path);
    }

    private void loadImg(ImageView iv, String path) {
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
        executor.shutdownNow();
        super.onDestroy();
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }

    private static String join(String sep, String... parts) {
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (p == null || p.isEmpty()) continue;
            if (sb.length() > 0) sb.append(sep);
            sb.append(p);
        }
        return sb.toString();
    }

    private static class SimilarItem {
        final int id;
        final String title;
        final String poster;
        final double rating;

        SimilarItem(int id, String title, String poster, double rating) {
            this.id = id;
            this.title = title;
            this.poster = poster;
            this.rating = rating;
        }
    }

    private class SimilarAdapter extends RecyclerView.Adapter<SimilarAdapter.H> {
        @NonNull
        @Override
        public H onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            return new H(getLayoutInflater().inflate(R.layout.item_mobile_poster, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            SimilarItem item = similar.get(position);
            holder.title.setText(item.title);
            loadImg(holder.image, item.poster);
            if (item.rating > 0) {
                holder.rating.setVisibility(View.VISIBLE);
                holder.rating.setText(String.format(Locale.US, "%.1f", item.rating));
            } else {
                holder.rating.setVisibility(View.GONE);
            }
            holder.itemView.setOnClickListener(v -> {
                Intent i = VixDetailRoutes.movieDetailIntent(MobileMovieDetailActivity.this, item.id);
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
