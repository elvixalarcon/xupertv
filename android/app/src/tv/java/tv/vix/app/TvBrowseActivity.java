package tv.vix.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class TvBrowseActivity extends AppCompatActivity {
    public static final String EXTRA_MODE = "mode";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_SERIES_ID = "series_id";
    public static final String EXTRA_SERIES_NAME = "series_name";

    public static final String MODE_LIVE = "live";
    public static final String MODE_MOVIES = "movies";
    public static final String MODE_SERIES = "series";
    public static final String MODE_EPISODES = "episodes";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final List<BrowseItem> items = new ArrayList<>();
    private RecyclerView list;
    private ProgressBar progress;
    private TextView emptyText;
    private TextView titleView;
    private String mode;
    private int seriesId;
    private String seriesName;
    private String liveGroup = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!NativeAuth.hasToken(this)) {
            startActivity(new Intent(this, TvLoginActivity.class));
            finish();
            return;
        }
        setContentView(R.layout.activity_tv_browse);

        mode = getIntent().getStringExtra(EXTRA_MODE);
        seriesId = getIntent().getIntExtra(EXTRA_SERIES_ID, 0);
        seriesName = getIntent().getStringExtra(EXTRA_SERIES_NAME);
        String title = getIntent().getStringExtra(EXTRA_TITLE);
        if (title == null) title = "Vix TV";

        titleView = findViewById(R.id.tv_browse_title);
        list = findViewById(R.id.tv_browse_list);
        progress = findViewById(R.id.tv_browse_progress);
        emptyText = findViewById(R.id.tv_browse_empty);

        titleView.setText(title);
        list.setLayoutManager(new LinearLayoutManager(this));
        list.setAdapter(new BrowseAdapter());
        list.setFocusable(true);

        loadData();
    }

    private void loadData() {
        progress.setVisibility(View.VISIBLE);
        emptyText.setVisibility(View.GONE);
        executor.execute(() -> {
            try {
                VixApi api = new VixApi(this);
                List<BrowseItem> loaded = new ArrayList<>();
                if (MODE_EPISODES.equals(mode)) {
                    JSONObject detail = api.seriesDetail(seriesId);
                    JSONArray eps = detail.optJSONArray("episodes");
                    if (eps != null) {
                        for (int i = 0; i < eps.length(); i++) {
                            JSONObject ep = eps.getJSONObject(i);
                            String label = "T" + ep.optInt("season", 1)
                                + " E" + ep.optInt("episode", i + 1)
                                + " · " + ep.optString("title", "");
                            loaded.add(new BrowseItem(
                                ep.optInt("id", 0),
                                label,
                                ep.optString("video_path", ""),
                                null,
                                seriesName
                            ));
                        }
                    }
                } else if (MODE_LIVE.equals(mode)) {
                    JSONArray channels = api.liveChannels(liveGroup);
                    for (int i = 0; i < channels.length(); i++) {
                        JSONObject ch = channels.getJSONObject(i);
                        loaded.add(new BrowseItem(
                            ch.optInt("id", 0),
                            ch.optString("name", "Canal"),
                            null,
                            ch.optString("logo", ""),
                            ch.optString("group_title", "")
                        ));
                    }
                } else if (MODE_MOVIES.equals(mode)) {
                    JSONArray movies = api.movies();
                    for (int i = 0; i < movies.length(); i++) {
                        JSONObject m = movies.getJSONObject(i);
                        String sub = m.optString("genre", "") + " · " + m.optInt("year", 0);
                        loaded.add(new BrowseItem(
                            m.optInt("id", 0),
                            m.optString("title", ""),
                            m.optString("video_path", ""),
                            m.optString("poster", ""),
                            sub
                        ));
                    }
                } else if (MODE_SERIES.equals(mode)) {
                    JSONArray series = api.series();
                    for (int i = 0; i < series.length(); i++) {
                        JSONObject s = series.getJSONObject(i);
                        loaded.add(new BrowseItem(
                            s.optInt("id", 0),
                            s.optString("title", ""),
                            null,
                            s.optString("poster", ""),
                            s.optString("genre", "")
                        ));
                    }
                }
                runOnUiThread(() -> {
                    progress.setVisibility(View.GONE);
                    items.clear();
                    items.addAll(loaded);
                    list.getAdapter().notifyDataSetChanged();
                    if (items.isEmpty()) {
                        emptyText.setVisibility(View.VISIBLE);
                        emptyText.setText("No hay contenido");
                    } else {
                        list.requestFocus();
                    }
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    progress.setVisibility(View.GONE);
                    emptyText.setVisibility(View.VISIBLE);
                    emptyText.setText(e.getMessage() != null ? e.getMessage() : "Error");
                    Toast.makeText(this, emptyText.getText(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void openItem(BrowseItem item) {
        if (MODE_SERIES.equals(mode)) {
            Intent i = new Intent(this, TvBrowseActivity.class);
            i.putExtra(EXTRA_MODE, MODE_EPISODES);
            i.putExtra(EXTRA_SERIES_ID, item.id);
            i.putExtra(EXTRA_SERIES_NAME, item.title);
            i.putExtra(EXTRA_TITLE, item.title);
            startActivity(i);
            return;
        }
        Intent play = new Intent(this, TvPlayerActivity.class);
        play.putExtra(TvPlayerActivity.EXTRA_TITLE, item.title);
        if (MODE_LIVE.equals(mode)) {
            play.putExtra(TvPlayerActivity.EXTRA_LIVE_CHANNEL_ID, item.id);
        } else {
            play.putExtra(TvPlayerActivity.EXTRA_VIDEO_PATH, item.videoPath);
        }
        startActivity(play);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            finish();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private static class BrowseItem {
        final int id;
        final String title;
        final String videoPath;
        final String poster;
        final String subtitle;

        BrowseItem(int id, String title, String videoPath, String poster, String subtitle) {
            this.id = id;
            this.title = title;
            this.videoPath = videoPath;
            this.poster = poster;
            this.subtitle = subtitle;
        }
    }

    private class BrowseAdapter extends RecyclerView.Adapter<BrowseAdapter.Holder> {
        @NonNull
        @Override
        public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_tv_row, parent, false);
            return new Holder(v);
        }

        @Override
        public void onBindViewHolder(@NonNull Holder holder, int position) {
            BrowseItem item = items.get(position);
            holder.title.setText(item.title);
            holder.sub.setText(item.subtitle != null ? item.subtitle : "");
            holder.itemView.setOnClickListener(v -> openItem(item));
            holder.itemView.setOnKeyListener((v, keyCode, event) -> {
                if (event.getAction() == KeyEvent.ACTION_DOWN
                    && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                        || keyCode == KeyEvent.KEYCODE_ENTER
                        || keyCode == KeyEvent.KEYCODE_BUTTON_A)) {
                    openItem(item);
                    return true;
                }
                return false;
            });
        }

        @Override
        public int getItemCount() {
            return items.size();
        }

        class Holder extends RecyclerView.ViewHolder {
            final TextView title;
            final TextView sub;

            Holder(View itemView) {
                super(itemView);
                title = itemView.findViewById(R.id.tv_row_title);
                sub = itemView.findViewById(R.id.tv_row_sub);
            }
        }
    }
}
