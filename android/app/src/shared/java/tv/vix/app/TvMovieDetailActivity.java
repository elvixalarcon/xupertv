package tv.vix.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.ui.PlayerView;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class TvMovieDetailActivity extends AppCompatActivity {
    public static final String EXTRA_MOVIE_ID = "movie_id";
    public static final String EXTRA_EXTERNAL_SOURCE = "external_source";
    public static final String EXTRA_EXTERNAL_SLUG = "external_slug";
    public static final String EXTRA_EXTERNAL_YEAR = "external_year";
    public static final String EXTRA_PREVIEW_IMAGE = TvPreviewExtras.EXTRA_PREVIEW_IMAGE;
    public static final String EXTRA_PREFILL_TITLE = TvPreviewExtras.EXTRA_PREFILL_TITLE;
    private static final long PREVIEW_SAVE_MS = 8000;
    private static final float PREVIEW_VOLUME = 0.85f;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());

    private int movieId;
    private String externalSource = "";
    private String externalSlug = "";
    private int externalYear;
    private boolean isExternal;
    private String serverBase = "";
    private String authToken = "";
    private JSONObject detail;
    private final List<SimilarItem> similar = new ArrayList<>();

    private ExoPlayer previewPlayer;
    private PlayerView previewView;
    private View previewWrap;
    private ImageView posterFallback;
    private RecyclerView similarList;
    private long previewPositionMs;
    private long savedProgressSec;
    private long watchDurationSec;
    private long lastPreviewSaveSec = -1;
    private long pendingPreviewSeekMs;
    private boolean returningFromFullscreen;
    private boolean openingFullscreen;
    private String previewImageUrl = "";

    private final Runnable previewSaveRunnable = this::savePreviewProgress;
    private ActivityResultLauncher<Intent> fullscreenLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TvPreviewExtras.applyInstantTransition(this);
        setContentView(R.layout.activity_tv_movie_detail);
        movieId = getIntent().getIntExtra(EXTRA_MOVIE_ID, 0);
        externalSource = getIntent().getStringExtra(EXTRA_EXTERNAL_SOURCE);
        if (externalSource == null) externalSource = "";
        externalSlug = getIntent().getStringExtra(EXTRA_EXTERNAL_SLUG);
        if (externalSlug == null) externalSlug = "";
        externalYear = getIntent().getIntExtra(EXTRA_EXTERNAL_YEAR, 0);
        isExternal = !externalSource.isEmpty() && !externalSlug.isEmpty();
        previewImageUrl = getIntent().getStringExtra(EXTRA_PREVIEW_IMAGE);
        if (previewImageUrl == null) previewImageUrl = "";
        serverBase = ServerUrlHelper.fromPrefs(getSharedPreferences(AppConstants.PREFS, MODE_PRIVATE));
        authToken = NativeAuth.getToken(this);

        if (!isExternal && movieId <= 0) {
            finish();
            return;
        }

        fullscreenLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                returningFromFullscreen = true;
                if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                    Intent data = result.getData();
                    long posMs = data.getLongExtra(TvPlayerActivity.EXTRA_POSITION_MS, -1);
                    long durMs = data.getLongExtra(TvPlayerActivity.EXTRA_DURATION_MS, 0);
                    if (posMs >= 0) {
                        previewPositionMs = posMs;
                        savedProgressSec = posMs / 1000L;
                    }
                    if (durMs > 0) watchDurationSec = durMs / 1000L;
                } else {
                    executor.execute(() -> {
                        try {
                            JSONObject wh = new VixApi(TvMovieDetailActivity.this).watchProgress("movie", movieId);
                            long prog = (long) wh.optDouble("progress", 0);
                            long dur = (long) wh.optDouble("duration", 0);
                            runOnUiThread(() -> {
                                if (prog > 0) {
                                    savedProgressSec = prog;
                                    previewPositionMs = prog * 1000L;
                                }
                                if (dur > 0) watchDurationSec = dur;
                                resumePreviewAfterFullscreen(getSeekMs());
                                handler.postDelayed(previewSaveRunnable, PREVIEW_SAVE_MS);
                            });
                        } catch (Exception e) {
                            runOnUiThread(() -> {
                                resumePreviewAfterFullscreen(getSeekMs());
                                handler.postDelayed(previewSaveRunnable, PREVIEW_SAVE_MS);
                            });
                        }
                    });
                    return;
                }
                resumePreviewAfterFullscreen(previewPositionMs > 0 ? previewPositionMs : getSeekMs());
                handler.postDelayed(previewSaveRunnable, PREVIEW_SAVE_MS);
            }
        );

        ProgressBar loading = findViewById(R.id.tv_detail_loading);
        previewView = findViewById(R.id.tv_detail_preview);
        previewWrap = findViewById(R.id.tv_detail_preview_wrap);
        posterFallback = findViewById(R.id.tv_detail_poster_fallback);

        Button playBtn = findViewById(R.id.tv_detail_play);
        Button fullscreenBtn = findViewById(R.id.tv_detail_fullscreen);

        View.OnClickListener openFull = v -> openFullscreen();
        fullscreenBtn.setOnClickListener(openFull);
        playBtn.setOnClickListener(openFull);
        previewWrap.setOnClickListener(openFull);
        bindEnter(fullscreenBtn, this::openFullscreen);
        bindEnter(playBtn, this::openFullscreen);
        bindEnter(previewWrap, this::openFullscreen);

        similarList = findViewById(R.id.tv_detail_similar);
        similarList.setLayoutManager(new LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false));
        similarList.setClipChildren(false);
        similarList.setClipToPadding(false);

        applyInstantPreviewFromIntent();
        loading.setVisibility(View.GONE);
        executor.execute(() -> {
            try {
                VixApi api = new VixApi(this);
                JSONObject json;
                long prog = 0;
                long dur = 0;
                if (isExternal) {
                    Integer year = externalYear > 0 ? externalYear : null;
                    json = api.externalMovieMeta(externalSource, externalSlug, year);
                } else {
                    json = api.movieDetail(movieId);
                    JSONObject wh = api.watchProgress("movie", movieId);
                    prog = (long) wh.optDouble("progress", 0);
                    dur = (long) wh.optDouble("duration", 0);
                }
                List<SimilarItem> sim = new ArrayList<>();
                JSONArray arr = json.optJSONArray("similar");
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject s = arr.getJSONObject(i);
                        if (TvCatalogHelper.isExternalItem(s)) continue;
                        sim.add(new SimilarItem(
                            s.optInt("id", 0),
                            s.optString("title", ""),
                            s.optString("poster", ""),
                            TvPosterBind.ratingFromJson(s)
                        ));
                    }
                }
                final long fProg = prog;
                final long fDur = dur;
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    detail = json;
                    savedProgressSec = fProg;
                    watchDurationSec = fDur;
                    if (!isExternal && watchDurationSec <= 0) {
                        int runtime = json.optInt("runtime", 0);
                        if (runtime > 0) watchDurationSec = runtime * 60L;
                    }
                    similar.clear();
                    similar.addAll(sim);
                    bindDetail(json);
                    similarList.setAdapter(new SimilarAdapter());
                    if (isExternal) {
                        if (previewWrap != null) previewWrap.setVisibility(View.GONE);
                        if (previewView != null) previewView.setVisibility(View.GONE);
                        playBtn.requestFocus();
                    } else {
                        long seekMs = fProg > 0 ? fProg * 1000L : 0;
                        startPreview(seekMs);
                        handler.postDelayed(previewSaveRunnable, PREVIEW_SAVE_MS);
                        previewWrap.requestFocus();
                    }
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

    private void applyInstantPreviewFromIntent() {
        String title = getIntent().getStringExtra(EXTRA_PREFILL_TITLE);
        if (title != null && !title.isEmpty()) {
            TextView titleView = findViewById(R.id.tv_detail_title);
            if (titleView != null) titleView.setText(title);
        }
        if (previewImageUrl.isEmpty()) return;
        if (posterFallback != null) {
            posterFallback.setVisibility(View.VISIBLE);
            loadImg(posterFallback, previewImageUrl);
        }
        ImageView backdrop = findViewById(R.id.tv_detail_backdrop);
        loadBackdrop(backdrop, previewImageUrl);
    }

    private void showPreviewPoster() {
        if (posterFallback != null && !previewImageUrl.isEmpty()) {
            posterFallback.setVisibility(View.VISIBLE);
        }
    }

    private void hidePreviewPosterWhenReady() {
        if (posterFallback != null) posterFallback.setVisibility(View.GONE);
    }

    private void bindDetail(JSONObject json) {
        TextView title = findViewById(R.id.tv_detail_title);
        TextView rating = findViewById(R.id.tv_detail_rating);
        TextView meta = findViewById(R.id.tv_detail_meta);
        TextView genres = findViewById(R.id.tv_detail_genres);
        TextView synopsis = findViewById(R.id.tv_detail_synopsis);
        ImageView backdrop = findViewById(R.id.tv_detail_backdrop);

        title.setText(json.optString("title", ""));
        double r = json.optDouble("rating", 0);
        rating.setText(r > 0 ? String.format(Locale.US, "%.1f", r) : "");
        rating.setVisibility(r > 0 ? View.VISIBLE : View.GONE);

        String year = json.optInt("year", 0) > 0 ? String.valueOf(json.optInt("year")) : "";
        String genre = json.optString("genre", "");
        meta.setText(join(" · ", year, genre));

        JSONArray gArr = json.optJSONArray("genres");
        if (gArr != null && gArr.length() > 0) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < gArr.length(); i++) {
                if (i > 0) sb.append(" · ");
                sb.append(gArr.optString(i));
            }
            genres.setText(sb.toString());
        } else if (!genre.isEmpty()) {
            genres.setText(genre);
        }

        String desc = json.optString("synopsis", "");
        if (desc.isEmpty()) desc = json.optString("description", "");
        synopsis.setText(desc);

        String posterUrl = json.optString("poster", "");
        String back = json.optString("backdrop", posterUrl);
        String banner = json.optString("banner", "");
        previewImageUrl = TvPreviewExtras.pickImage(banner, back, posterUrl);
        if (posterFallback != null && posterFallback.getDrawable() == null) {
            loadImg(posterFallback, previewImageUrl.isEmpty() ? posterUrl : previewImageUrl);
        }
        loadBackdrop(backdrop, back.isEmpty() ? previewImageUrl : back);
    }

    private void loadBackdrop(ImageView iv, String path) {
        String url = PlayUrls.poster(serverBase, path);
        if (url.isEmpty() || iv == null) return;
        iv.setAlpha(0.62f);
        Glide.with(this).load(url).centerCrop().into(iv);
    }

    private long getSeekMs() {
        if (previewPositionMs > 0) return previewPositionMs;
        if (savedProgressSec > 0) return savedProgressSec * 1000L;
        return 0;
    }

    private void resumePreviewAt(long seekMs) {
        if (previewPlayer != null) {
            seekPreviewWhenReady(seekMs);
            previewPlayer.setVolume(PREVIEW_VOLUME);
            previewPlayer.setPlayWhenReady(true);
            if (previewPlayer.getPlaybackState() == Player.STATE_READY) {
                hidePreviewPosterWhenReady();
            } else {
                showPreviewPoster();
            }
            return;
        }
        startPreview(seekMs);
    }

    /** Vuelve del fullscreen sin recargar el stream si el reproductor sigue activo. */
    private void resumePreviewAfterFullscreen(long seekMs) {
        showPreviewPoster();
        if (previewPlayer != null) {
            long pos = seekMs > 0 ? seekMs : previewPlayer.getCurrentPosition();
            if (pos > 0 && Math.abs(previewPlayer.getCurrentPosition() - pos) > 2500) {
                previewPlayer.seekTo(pos);
            }
            previewPositionMs = previewPlayer.getCurrentPosition();
            previewPlayer.setVolume(PREVIEW_VOLUME);
            previewPlayer.setPlayWhenReady(true);
            if (previewPlayer.getPlaybackState() == Player.STATE_READY && previewPlayer.isPlaying()) {
                hidePreviewPosterWhenReady();
            }
            return;
        }
        resumePreviewAt(seekMs);
    }

    private void seekPreviewWhenReady(long seekMs) {
        if (previewPlayer == null || seekMs <= 0) return;
        if (previewPlayer.getPlaybackState() == Player.STATE_READY) {
            previewPlayer.seekTo(seekMs);
            pendingPreviewSeekMs = 0;
        } else {
            pendingPreviewSeekMs = seekMs;
        }
    }

    private void startPreview(long seekMs) {
        if (detail == null || previewView == null) return;
        String path = detail.optString("video_path", "");
        String playUrl = PlayUrls.video(serverBase, authToken, path);
        if (playUrl == null || playUrl.isEmpty()) {
            showPreviewPoster();
            return;
        }
        showPreviewPoster();
        pendingPreviewSeekMs = seekMs;
        previewPositionMs = seekMs;
        if (previewPlayer != null) {
            seekPreviewWhenReady(seekMs);
            previewPlayer.setPlayWhenReady(true);
            return;
        }
        try {
            DefaultHttpDataSource.Factory dataFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent("VixTV/1.0 tv")
                .setAllowCrossProtocolRedirects(true);
            if (playUrl.contains("token=")) {
                dataFactory.setDefaultRequestProperties(
                    java.util.Collections.singletonMap("Authorization", "Bearer " + authToken)
                );
            }
            MediaSource source;
            if (PlayUrls.isHlsPlaybackUrl(playUrl)) {
                source = new HlsMediaSource.Factory(dataFactory)
                    .createMediaSource(MediaItem.fromUri(Uri.parse(playUrl)));
            } else {
                source = new ProgressiveMediaSource.Factory(dataFactory)
                    .createMediaSource(MediaItem.fromUri(Uri.parse(playUrl)));
            }
            previewPlayer = new ExoPlayer.Builder(this).build();
            previewView.setPlayer(previewPlayer);
            previewPlayer.setMediaSource(source);
            previewPlayer.prepare();
            previewPlayer.setPlayWhenReady(true);
            previewPlayer.setVolume(0.85f);
            previewPlayer.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY && pendingPreviewSeekMs > 0 && previewPlayer != null) {
                        previewPlayer.seekTo(pendingPreviewSeekMs);
                        previewPositionMs = pendingPreviewSeekMs;
                        pendingPreviewSeekMs = 0;
                    }
                    if (state == Player.STATE_READY && previewPlayer != null && previewPlayer.isPlaying()) {
                        runOnUiThread(() -> hidePreviewPosterWhenReady());
                    }
                }

                @Override
                public void onIsPlayingChanged(boolean isPlaying) {
                    if (isPlaying && previewPlayer != null) {
                        previewPositionMs = previewPlayer.getCurrentPosition();
                        runOnUiThread(() -> hidePreviewPosterWhenReady());
                    }
                }

                @Override
                public void onPlayerError(PlaybackException error) {
                    runOnUiThread(() -> showPreviewPoster());
                }
            });
        } catch (Throwable e) {
            showPreviewPoster();
        }
    }

    private void savePreviewProgress() {
        if (previewPlayer == null || isFinishing()) return;
        long posSec = previewPlayer.getCurrentPosition() / 1000L;
        long durSec = previewPlayer.getDuration() > 0
            ? previewPlayer.getDuration() / 1000L
            : watchDurationSec;
        if (posSec < 5) {
            handler.postDelayed(previewSaveRunnable, PREVIEW_SAVE_MS);
            return;
        }
        if (lastPreviewSaveSec >= 0 && Math.abs(posSec - lastPreviewSaveSec) < 8) {
            handler.postDelayed(previewSaveRunnable, PREVIEW_SAVE_MS);
            return;
        }
        lastPreviewSaveSec = posSec;
        savedProgressSec = posSec;
        previewPositionMs = posSec * 1000L;
        if (durSec > 0) watchDurationSec = durSec;
        final long p = posSec;
        final long d = durSec;
        executor.execute(() -> {
            try {
                new VixApi(TvMovieDetailActivity.this).saveWatchProgress("movie", movieId, 0, p, d);
            } catch (Exception ignored) { }
        });
        handler.postDelayed(previewSaveRunnable, PREVIEW_SAVE_MS);
    }

    private void savePreviewProgressNow() {
        if (previewPlayer == null) return;
        long posSec = previewPlayer.getCurrentPosition() / 1000L;
        long durSec = previewPlayer.getDuration() > 0
            ? previewPlayer.getDuration() / 1000L
            : watchDurationSec;
        if (posSec < 5) return;
        savedProgressSec = posSec;
        previewPositionMs = posSec * 1000L;
        if (durSec > 0) watchDurationSec = durSec;
        final long p = posSec;
        final long d = durSec;
        executor.execute(() -> {
            try {
                new VixApi(TvMovieDetailActivity.this).saveWatchProgress("movie", movieId, 0, p, d);
            } catch (Exception ignored) { }
        });
    }

    private void pausePreview() {
        if (previewPlayer != null) {
            previewPositionMs = previewPlayer.getCurrentPosition();
            previewPlayer.setPlayWhenReady(false);
        }
    }

    private void releasePreview() {
        handler.removeCallbacks(previewSaveRunnable);
        if (previewPlayer != null) {
            previewPositionMs = previewPlayer.getCurrentPosition();
            previewPlayer.setPlayWhenReady(false);
            previewPlayer.release();
            previewPlayer = null;
        }
        if (previewView != null) previewView.setPlayer(null);
    }

    private void openFullscreen() {
        if (detail == null) return;
        if (isExternal) {
            openExternalFullscreen();
            return;
        }
        String path = detail.optString("video_path", "");
        if (path == null || path.isEmpty()) {
            Toast.makeText(this, "Video no disponible", Toast.LENGTH_LONG).show();
            return;
        }
        long startMs = previewPlayer != null ? previewPlayer.getCurrentPosition() : getSeekMs();
        if (startMs > 0) {
            previewPositionMs = startMs;
            savedProgressSec = startMs / 1000L;
        }
        savePreviewProgressNow();
        openingFullscreen = true;
        showPreviewPoster();
        if (previewPlayer != null) {
            previewPlayer.setVolume(0f);
            previewPlayer.setPlayWhenReady(false);
        }

        Intent i = new Intent(this, TvPlayerActivity.class);
        i.putExtra(TvPlayerActivity.EXTRA_TITLE, detail.optString("title", ""));
        i.putExtra(TvPlayerActivity.EXTRA_VIDEO_PATH, path);
        i.putExtra(TvPlayerActivity.EXTRA_START_MS, startMs);
        i.putExtra(TvPlayerActivity.EXTRA_START_SEC, startMs / 1000L);
        i.putExtra(TvPlayerActivity.EXTRA_CONTENT_TYPE, "movie");
        i.putExtra(TvPlayerActivity.EXTRA_CONTENT_ID, movieId);
        if (!previewImageUrl.isEmpty()) {
            i.putExtra(TvPlayerActivity.EXTRA_PREVIEW_IMAGE, previewImageUrl);
        }
        fullscreenLauncher.launch(i);
        TvPreviewExtras.applyInstantTransition(this);
    }

    private void openExternalFullscreen() {
        Button playBtn = findViewById(R.id.tv_detail_play);
        if (playBtn != null) playBtn.setEnabled(false);
        executor.execute(() -> {
            try {
                VixApi api = new VixApi(this);
                int year = externalYear > 0 ? externalYear : detail.optInt("year", 0);
                Integer yearArg = year > 0 ? year : null;
                JSONObject play = api.externalMoviePlay(externalSource, externalSlug, yearArg, "1080");
                String path = TvCatalogHelper.externalPlayUrl(serverBase, play);
                if (path == null || path.isEmpty()) {
                    throw new Exception("Video no disponible");
                }
                final String videoPath = path;
                runOnUiThread(() -> {
                    if (playBtn != null) playBtn.setEnabled(true);
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
                    if (playBtn != null) playBtn.setEnabled(true);
                    Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void loadImg(ImageView iv, String path) {
        String url = PlayUrls.poster(serverBase, path);
        if (url.isEmpty()) return;
        Glide.with(this).load(url).centerCrop().into(iv);
    }

    @Override
    protected void onPause() {
        savePreviewProgressNow();
        if (!openingFullscreen) pausePreview();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        PlaybackScreenWake.keepOn(this, previewView != null ? previewView : getWindow().getDecorView());
        if (detail == null) return;
        if (returningFromFullscreen) {
            returningFromFullscreen = false;
            openingFullscreen = false;
            TvPreviewExtras.applyInstantTransition(this);
            if (previewPlayer != null) {
                previewPlayer.setVolume(PREVIEW_VOLUME);
                previewPlayer.setPlayWhenReady(true);
                if (previewPlayer.isPlaying()) {
                    hidePreviewPosterWhenReady();
                } else {
                    showPreviewPoster();
                }
            } else {
                showPreviewPoster();
            }
            handler.postDelayed(previewSaveRunnable, PREVIEW_SAVE_MS);
            return;
        }
        openingFullscreen = false;
        if (previewPlayer != null) {
            resumePreviewAt(previewPositionMs > 0 ? previewPositionMs : getSeekMs());
        } else {
            startPreview(getSeekMs());
        }
        handler.postDelayed(previewSaveRunnable, PREVIEW_SAVE_MS);
    }

    @Override
    protected void onDestroy() {
        savePreviewProgressNow();
        releasePreview();
        PlaybackScreenWake.release(this, previewView);
        handler.removeCallbacksAndMessages(null);
        executor.shutdownNow();
        super.onDestroy();
    }

    private void bindEnter(View v, Runnable action) {
        v.setOnKeyListener((view, keyCode, ev) -> {
            if (ev.getAction() == KeyEvent.ACTION_DOWN && isEnter(keyCode)) {
                action.run();
                return true;
            }
            return false;
        });
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

    private boolean isEnter(int code) {
        return code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
            || code == KeyEvent.KEYCODE_NUMPAD_ENTER || code == KeyEvent.KEYCODE_BUTTON_A;
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
            return new H(getLayoutInflater().inflate(R.layout.item_tv_poster, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            SimilarItem item = similar.get(position);
            holder.title.setText(item.title);
            loadImg(holder.image, item.poster);
            TvPosterBind.bindRatingBadge(holder.rating, item.rating);
            holder.itemView.setOnFocusChangeListener((v, has) -> {
                TvFocusAnim.applyPoster(v, has);
                if (has && similarList != null) similarList.smoothScrollToPosition(position);
            });
            holder.itemView.setOnClickListener(v -> {
                savePreviewProgressNow();
                releasePreview();
                Intent i = new Intent(TvMovieDetailActivity.this, TvMovieDetailActivity.class);
                i.putExtra(EXTRA_MOVIE_ID, item.id);
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
                image = v.findViewById(R.id.tv_poster_img);
                title = v.findViewById(R.id.tv_poster_title);
                rating = v.findViewById(R.id.tv_poster_rating);
            }
        }
    }
}
