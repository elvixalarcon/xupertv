package tv.vix.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class TvCategoryBrowseActivity extends AppCompatActivity {
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_GENRE = "genre";
    public static final String EXTRA_SECTION_ID = "section_id";
    public static final String EXTRA_ROW_TYPE = "row_type";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final List<CatalogItem> items = new ArrayList<>();

    private String serverBase = "";
    private RecyclerView grid;
    private ProgressBar loading;
    private TextView empty;
    private TextView titleView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!NativeAuth.hasToken(this)) {
            startActivity(new Intent(this, VixAuthRoutes.loginActivityClass()));
            finish();
            return;
        }
        setContentView(R.layout.activity_tv_category_grid);
        serverBase = ServerUrlHelper.fromPrefs(getSharedPreferences(AppConstants.PREFS, MODE_PRIVATE));

        String title = getIntent().getStringExtra(EXTRA_TITLE);
        if (title == null || title.isEmpty()) title = "Categoría";

        titleView = findViewById(R.id.tv_cat_grid_title);
        grid = findViewById(R.id.tv_cat_grid_list);
        loading = findViewById(R.id.tv_cat_grid_loading);
        empty = findViewById(R.id.tv_cat_grid_empty);
        titleView.setText(title);

        int span = getResources().getConfiguration().screenWidthDp >= 1200 ? 6 : 5;
        grid.setLayoutManager(new GridLayoutManager(this, span));
        grid.setAdapter(new GridAdapter());
        grid.setClipChildren(false);
        grid.setClipToPadding(false);

        loadItems();
    }

    private void loadItems() {
        loading.setVisibility(View.VISIBLE);
        empty.setVisibility(View.GONE);
        String genre = getIntent().getStringExtra(EXTRA_GENRE);
        String sectionId = getIntent().getStringExtra(EXTRA_SECTION_ID);
        String rowType = getIntent().getStringExtra(EXTRA_ROW_TYPE);
        if (rowType == null) rowType = "movie";
        final String contentKind = rowType;

        executor.execute(() -> {
            try {
                VixApi api = new VixApi(this);
                JSONArray arr;
                if (sectionId != null && !sectionId.isEmpty()) {
                    arr = api.catalogSection(sectionId);
                } else if (genre != null && !genre.isEmpty()) {
                    if ("series".equals(contentKind)) {
                        arr = api.seriesByGenre(genre);
                    } else {
                        arr = api.moviesByGenre(genre);
                    }
                } else {
                    arr = new JSONArray();
                }
                List<CatalogItem> loaded = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    if (TvCatalogHelper.isExternalItem(o)) {
                        loaded.add(externalItem(o));
                        continue;
                    }
                    String type = TvCatalogHelper.resolveContentType(o, contentKind);
                    if ("series".equals(type)) {
                        loaded.add(seriesItem(o));
                    } else {
                        loaded.add(movieItem(o));
                    }
                }
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    items.clear();
                    items.addAll(loaded);
                    grid.getAdapter().notifyDataSetChanged();
                    if (items.isEmpty()) {
                        empty.setVisibility(View.VISIBLE);
                        empty.setText("Sin contenido");
                    } else {
                        grid.requestFocus();
                    }
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    empty.setVisibility(View.VISIBLE);
                    empty.setText(e.getMessage());
                    Toast.makeText(this, empty.getText(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private static CatalogItem movieItem(JSONObject m) {
        return new CatalogItem(
            m.optInt("id", 0),
            m.optString("title", ""),
            m.optString("poster", ""),
            m.optString("video_path", ""),
            false,
            TvPosterBind.ratingFromJson(m)
        );
    }

    private static CatalogItem seriesItem(JSONObject s) {
        return new CatalogItem(
            s.optInt("id", 0),
            s.optString("title", ""),
            s.optString("poster", ""),
            null,
            true,
            TvPosterBind.ratingFromJson(s)
        );
    }

    private static CatalogItem externalItem(JSONObject o) {
        String type = o.optString("content_type", "movie");
        boolean isSeries = "series".equals(type);
        return new CatalogItem(
            0,
            o.optString("title", ""),
            o.optString("poster", ""),
            null,
            isSeries,
            TvPosterBind.ratingFromJson(o),
            true,
            o.optString("source", ""),
            o.optString("slug", ""),
            o.optInt("year", 0)
        );
    }

    private void openItem(CatalogItem item) {
        if (item.external) {
            if (item.isSeries) {
                TvCatalogHelper.openExternalSeries(this, item.source, item.slug,
                    item.title, "", "", item.poster);
            } else {
                TvCatalogHelper.openExternalMovie(this, item.source, item.slug, item.year,
                    item.title, "", "", item.poster);
            }
            return;
        }
        if (item.isSeries) {
            Intent i = VixDetailRoutes.seriesDetailIntent(this, item.id);
            startActivity(i);
            return;
        }
        Intent i = VixDetailRoutes.movieDetailIntent(this, item.id);
        startActivity(i);
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

    /** Mismo modelo que TvShellActivity.CatalogItem (paquete compartido). */
    static class CatalogItem {
        final int id;
        final String title;
        final String poster;
        final String videoPath;
        final boolean isSeries;
        final double rating;
        final boolean external;
        final String source;
        final String slug;
        final int year;

        CatalogItem(int id, String title, String poster, String videoPath,
                    boolean isSeries, double rating) {
            this(id, title, poster, videoPath, isSeries, rating, false, "", "", 0);
        }

        CatalogItem(int id, String title, String poster, String videoPath,
                    boolean isSeries, double rating, boolean external,
                    String source, String slug, int year) {
            this.id = id;
            this.title = title;
            this.poster = poster;
            this.videoPath = videoPath;
            this.isSeries = isSeries;
            this.rating = rating;
            this.external = external;
            this.source = source != null ? source : "";
            this.slug = slug != null ? slug : "";
            this.year = year;
        }
    }

    private class GridAdapter extends RecyclerView.Adapter<GridAdapter.GH> {
        @NonNull
        @Override
        public GH onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            return new GH(getLayoutInflater().inflate(R.layout.item_tv_poster, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull GH holder, int position) {
            CatalogItem item = items.get(position);
            holder.title.setText(item.title);
            TvPosterBind.bindRatingBadge(holder.rating, item.rating);
            String url = PlayUrls.posterForItem(serverBase, item.title, item.year, item.poster);
            if (url.isEmpty()) {
                holder.image.setImageDrawable(null);
            } else {
                Glide.with(TvCategoryBrowseActivity.this).load(url).centerCrop().into(holder.image);
            }
            holder.itemView.setOnClickListener(v -> openItem(item));
            holder.itemView.setOnKeyListener((v, keyCode, ev) -> {
                if (ev.getAction() == KeyEvent.ACTION_DOWN
                    && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                        || keyCode == KeyEvent.KEYCODE_ENTER
                        || keyCode == KeyEvent.KEYCODE_BUTTON_A)) {
                    openItem(item);
                    return true;
                }
                return false;
            });
            holder.itemView.setOnFocusChangeListener((v, has) -> TvFocusAnim.applyPoster(v, has));
        }

        @Override
        public int getItemCount() {
            return items.size();
        }

        class GH extends RecyclerView.ViewHolder {
            final ImageView image;
            final TextView title;
            final TextView rating;

            GH(View v) {
                super(v);
                image = v.findViewById(R.id.tv_poster_img);
                title = v.findViewById(R.id.tv_poster_title);
                rating = v.findViewById(R.id.tv_poster_rating);
            }
        }
    }
}
