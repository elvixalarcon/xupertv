package tv.vix.app;

import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.GridLayout;
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

public class TvSearchActivity extends AppCompatActivity {
    private static final int MIN_QUERY_LEN = 2;
    private static final long SEARCH_DEBOUNCE_MS = 320L;
    private static final int GRID_COLUMNS = 5;
    private static final int KEYBOARD_COLS = 8;
    private static final int POPULAR_LIMIT = 10;

    private static final String[] LETTERS = {
        "A", "B", "C", "D", "E", "F", "G",
        "H", "I", "J", "K", "L", "M", "N",
        "O", "P", "Q", "R", "S", "T", "U",
        "V", "W", "X", "Y", "Z", "Ñ"
    };
    private static final String[] NUMBERS = {
        "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"
    };

    private final List<JSONObject> results = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final StringBuilder query = new StringBuilder();

    private TextView input;
    private TextView heading;
    private TextView total;
    private TextView empty;
    private TextView refreshBtn;
    private ProgressBar loading;
    private RecyclerView list;
    private GridLayout keyboard;
    private View firstKeyboardKey;

    private ResultAdapter adapter;
    private int searchGeneration;
    private Runnable debouncedSearch;
    private boolean numericMode;
    private boolean showingPopular;
    private String serverBase = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_tv_search);
        serverBase = new VixApi(this).baseUrl();

        input = findViewById(R.id.tv_search_input);
        heading = findViewById(R.id.tv_search_heading);
        total = findViewById(R.id.tv_search_total);
        empty = findViewById(R.id.tv_search_empty);
        refreshBtn = findViewById(R.id.tv_search_refresh);
        loading = findViewById(R.id.tv_search_loading);
        list = findViewById(R.id.tv_search_results);
        keyboard = findViewById(R.id.tv_search_keyboard);

        GridLayoutManager glm = new GridLayoutManager(this, GRID_COLUMNS);
        list.setLayoutManager(glm);
        list.setItemAnimator(null);
        list.setHasFixedSize(false);
        adapter = new ResultAdapter();
        list.setAdapter(adapter);

        list.setOnKeyListener((v, keyCode, event) -> {
            if (event.getAction() != KeyEvent.ACTION_DOWN) return false;
            if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
                View focused = getCurrentFocus();
                if (focused != null) {
                    int pos = list.getChildAdapterPosition(focused);
                    if (pos >= 0 && pos % GRID_COLUMNS == 0) {
                        if (firstKeyboardKey != null) {
                            firstKeyboardKey.requestFocus();
                            return true;
                        }
                    }
                }
            }
            return false;
        });

        refreshBtn.setOnClickListener(v -> loadPopular(true));
        bindEnter(refreshBtn, () -> loadPopular(true));
        refreshBtn.setOnFocusChangeListener((v, has) -> {
            float scale = has ? 1.06f : 1f;
            v.animate().scaleX(scale).scaleY(scale).setDuration(140).start();
        });

        rebuildKeyboard();
        updateQueryDisplay();
        loadPopular(false);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        executor.shutdownNow();
        super.onDestroy();
    }

    private void rebuildKeyboard() {
        keyboard.removeAllViews();
        firstKeyboardKey = null;

        int row = 0;
        View modeKey = addKey("123", row, 0, 1, 1, this::toggleNumericMode, true);
        if (firstKeyboardKey == null) firstKeyboardKey = modeKey;

        addKey("✕", row, 1, 1, 1, this::clearQuery, false);
        addKey("⌫", row, 2, 1, 1, this::backspace, false);
        addKey("Buscar", row, 3, 1, 2, this::runSearchNow, true);

        row++;
        if (numericMode) {
            for (int i = 0; i < NUMBERS.length; i++) {
                final String digit = NUMBERS[i];
                addKey(digit, row + (i / KEYBOARD_COLS), i % KEYBOARD_COLS, 1, 1, () -> appendText(digit), false);
            }
            row += 2;
            addKey("ABC", row, 0, 1, 2, this::toggleNumericMode, true);
            addKey("espacio", row, 2, 1, 6, () -> appendText(" "), false);
        } else {
            for (int i = 0; i < LETTERS.length; i++) {
                final String letter = LETTERS[i];
                addKey(letter, row + (i / KEYBOARD_COLS), i % KEYBOARD_COLS, 1, 1, () -> appendText(letter), false);
            }
            row += (LETTERS.length + KEYBOARD_COLS - 1) / KEYBOARD_COLS;
            addKey("espacio", row, 0, 1, KEYBOARD_COLS, () -> appendText(" "), false);
        }

        if (firstKeyboardKey != null) {
            firstKeyboardKey.post(firstKeyboardKey::requestFocus);
        }
    }

    private View addKey(String label, int row, int col, int rowSpan, int colSpan, Runnable action) {
        return addKey(label, row, col, rowSpan, colSpan, action, false);
    }

    private View addKey(String label, int row, int col, int rowSpan, int colSpan, Runnable action, boolean actionStyle) {
        TextView key = new TextView(this);
        key.setText(label);
        key.setTextColor(getColor(actionStyle ? R.color.tv_accent : R.color.tv_text));
        float textSp = label.length() <= 1 ? 11f : (label.length() <= 4 ? 10f : 9f);
        key.setTextSize(TypedValue.COMPLEX_UNIT_SP, textSp);
        key.setTypeface(Typeface.create(Typeface.DEFAULT, actionStyle ? Typeface.BOLD : Typeface.NORMAL));
        key.setGravity(Gravity.CENTER);
        key.setBackgroundResource(actionStyle ? R.drawable.tv_keyboard_key_action_bg : R.drawable.tv_keyboard_key_bg);
        key.setFocusable(true);
        key.setClickable(true);
        key.setMinHeight(dp(26));
        int hPad = dp(2);
        int vPad = dp(4);
        key.setPadding(hPad, vPad, hPad, vPad);

        GridLayout.LayoutParams lp = new GridLayout.LayoutParams();
        lp.rowSpec = GridLayout.spec(row, rowSpan, 1f);
        lp.columnSpec = GridLayout.spec(col, colSpan, 1f);
        lp.width = 0;
        lp.height = ViewGroup.LayoutParams.WRAP_CONTENT;
        int gap = dp(2);
        lp.setMargins(gap, gap, gap, gap);
        key.setLayoutParams(lp);

        key.setOnClickListener(v -> action.run());
        bindEnter(key, action);
        key.setOnFocusChangeListener((v, has) -> {
            float scale = has ? 1.05f : 1f;
            v.animate().scaleX(scale).scaleY(scale).setDuration(100).start();
        });
        key.setOnKeyListener((v, keyCode, event) -> {
            if (event.getAction() == KeyEvent.ACTION_DOWN && keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
                focusFirstResult();
                return true;
            }
            return false;
        });

        keyboard.addView(key);
        return key;
    }

    private void toggleNumericMode() {
        numericMode = !numericMode;
        rebuildKeyboard();
    }

    private void appendText(String text) {
        query.append(text);
        updateQueryDisplay();
        scheduleLiveSearch();
    }

    private void backspace() {
        if (query.length() == 0) return;
        query.deleteCharAt(query.length() - 1);
        updateQueryDisplay();
        scheduleLiveSearch();
    }

    private void clearQuery() {
        query.setLength(0);
        updateQueryDisplay();
        scheduleLiveSearch();
    }

    private void updateQueryDisplay() {
        String q = query.toString().trim();
        if (q.isEmpty()) {
            input.setText("");
            heading.setText("Búsqueda popular");
        } else {
            input.setText(query.toString());
            heading.setText("Resultados");
        }
    }

    private void scheduleLiveSearch() {
        if (debouncedSearch != null) handler.removeCallbacks(debouncedSearch);
        debouncedSearch = this::runSearchNow;
        handler.postDelayed(debouncedSearch, SEARCH_DEBOUNCE_MS);
    }

    private void runSearchNow() {
        String q = query.toString().trim();
        if (q.length() < MIN_QUERY_LEN) {
            if (q.isEmpty()) {
                loadPopular(false);
            } else {
                searchGeneration++;
                loading.setVisibility(View.GONE);
                results.clear();
                adapter.notifyDataSetChanged();
                updateEmptyState(q, false);
                updateTotal(0);
            }
            return;
        }
        showingPopular = false;
        final int generation = ++searchGeneration;
        loading.setVisibility(View.VISIBLE);
        empty.setVisibility(View.GONE);
        executor.execute(() -> {
            try {
                List<JSONObject> found = fetchResults(q);
                runOnUiThread(() -> {
                    if (generation != searchGeneration || isFinishing()) return;
                    loading.setVisibility(View.GONE);
                    results.clear();
                    results.addAll(found);
                    adapter.notifyDataSetChanged();
                    updateEmptyState(q, found.isEmpty());
                    updateTotal(found.size());
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (generation != searchGeneration || isFinishing()) return;
                    loading.setVisibility(View.GONE);
                    results.clear();
                    adapter.notifyDataSetChanged();
                    empty.setVisibility(View.VISIBLE);
                    empty.setText("Error de búsqueda");
                    updateTotal(0);
                    Toast.makeText(this, e.getMessage(), Toast.LENGTH_SHORT).show();
                });
            }
        });
    }

    private void loadPopular(boolean fromRefresh) {
        showingPopular = true;
        searchGeneration++;
        loading.setVisibility(View.VISIBLE);
        empty.setVisibility(View.GONE);
        query.setLength(0);
        updateQueryDisplay();
        executor.execute(() -> {
            try {
                List<JSONObject> popular = fetchPopular();
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    loading.setVisibility(View.GONE);
                    results.clear();
                    results.addAll(popular);
                    adapter.notifyDataSetChanged();
                    updateEmptyState("", popular.isEmpty());
                    updateTotal(popular.size());
                    if (fromRefresh && popular.isEmpty()) {
                        Toast.makeText(this, "Sin sugerencias", Toast.LENGTH_SHORT).show();
                    }
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    loading.setVisibility(View.GONE);
                    results.clear();
                    adapter.notifyDataSetChanged();
                    empty.setVisibility(View.VISIBLE);
                    empty.setText("No se pudo cargar");
                    updateTotal(0);
                });
            }
        });
    }

    private List<JSONObject> fetchPopular() throws Exception {
        List<JSONObject> found = new ArrayList<>();
        VixApi api = new VixApi(this);
        JSONArray hero = api.moviesHero();
        for (int i = 0; i < Math.min(POPULAR_LIMIT, hero.length()); i++) {
            JSONObject m = hero.getJSONObject(i);
            JSONObject o = new JSONObject();
            o.put("content_type", m.optString("content_type", "movie"));
            o.put("content_id", m.optInt("id", 0));
            o.put("title", m.optString("title", ""));
            String poster = m.optString("poster", "");
            if (poster.isEmpty()) poster = m.optString("backdrop", "");
            o.put("poster", poster);
            o.put("rating", m.optDouble("rating", 0));
            found.add(o);
        }
        return found;
    }

    private List<JSONObject> fetchResults(String q) throws Exception {
        List<JSONObject> found = new ArrayList<>();
        VixApi api = new VixApi(this);
        JSONObject data = api.globalSearch(q);
        JSONArray movies = data.optJSONArray("movies");
        if (movies != null) {
            for (int i = 0; i < movies.length(); i++) {
                JSONObject m = movies.getJSONObject(i);
                JSONObject o = new JSONObject();
                o.put("content_type", "movie");
                o.put("content_id", m.optInt("id", 0));
                o.put("title", m.optString("title", ""));
                o.put("poster", m.optString("poster", ""));
                o.put("rating", m.optDouble("rating", 0));
                found.add(o);
            }
        }
        JSONArray series = data.optJSONArray("series");
        if (series != null) {
            for (int i = 0; i < series.length(); i++) {
                JSONObject s = series.getJSONObject(i);
                JSONObject o = new JSONObject();
                o.put("content_type", "series");
                o.put("content_id", s.optInt("id", 0));
                o.put("title", s.optString("title", ""));
                o.put("poster", s.optString("poster", ""));
                o.put("rating", s.optDouble("rating", 0));
                found.add(o);
            }
        }
        JSONArray live = data.optJSONArray("live");
        if (live != null) {
            for (int i = 0; i < live.length(); i++) {
                JSONObject ch = live.getJSONObject(i);
                JSONObject o = new JSONObject();
                o.put("content_type", "live");
                o.put("content_id", ch.optInt("id", 0));
                o.put("title", ch.optString("name", ""));
                o.put("poster", ch.optString("logo", ""));
                o.put("rating", 0);
                found.add(o);
            }
        }
        return found;
    }

    private void updateEmptyState(String q, boolean noResults) {
        if (showingPopular) {
            if (noResults) {
                empty.setVisibility(View.VISIBLE);
                empty.setText("Sin sugerencias");
            } else {
                empty.setVisibility(View.GONE);
            }
            return;
        }
        if (q.isEmpty()) {
            empty.setVisibility(View.GONE);
            return;
        }
        if (q.length() < MIN_QUERY_LEN) {
            empty.setVisibility(View.VISIBLE);
            empty.setText("Escribe al menos " + MIN_QUERY_LEN + " letras");
            return;
        }
        if (noResults) {
            empty.setVisibility(View.VISIBLE);
            empty.setText("Sin resultados");
            return;
        }
        empty.setVisibility(View.GONE);
    }

    private void updateTotal(int count) {
        total.setText("Total: " + count);
    }

    private void focusFirstResult() {
        if (list.getChildCount() > 0) {
            list.getChildAt(0).requestFocus();
            return;
        }
        list.post(() -> {
            if (list.getChildCount() > 0) list.getChildAt(0).requestFocus();
        });
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private class ResultAdapter extends RecyclerView.Adapter<ResultAdapter.H> {
        @NonNull
        @Override
        public H onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = getLayoutInflater().inflate(R.layout.item_tv_search_poster, parent, false);
            return new H(v);
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            JSONObject item = results.get(position);
            String title = item.optString("title", "");
            holder.title.setText(title);
            TvPosterBind.bindRatingBadge(holder.rating, item.optDouble("rating", 0));

            String poster = item.optString("poster", "");
            String url = PlayUrls.poster(serverBase, poster);
            if (url.isEmpty()) {
                holder.image.setImageDrawable(null);
                holder.image.setBackgroundResource(R.drawable.tv_channel_logo_placeholder);
            } else {
                holder.image.setBackgroundResource(R.drawable.tv_channel_focus_bg);
                Glide.with(TvSearchActivity.this).load(url).centerCrop().into(holder.image);
            }

            holder.itemView.setOnClickListener(v -> TvContentHelper.open(TvSearchActivity.this, item));
            bindEnter(holder.itemView, () -> TvContentHelper.open(TvSearchActivity.this, item));
            holder.itemView.setOnFocusChangeListener((v, has) -> TvFocusAnim.applyPoster(v, has));
        }

        @Override
        public int getItemCount() { return results.size(); }

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

    private void bindEnter(View v, Runnable action) {
        v.setOnKeyListener((view, keyCode, ev) -> {
            if (ev.getAction() == KeyEvent.ACTION_DOWN
                && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                || keyCode == KeyEvent.KEYCODE_ENTER
                || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
                || keyCode == KeyEvent.KEYCODE_BUTTON_A)) {
                action.run();
                return true;
            }
            return false;
        });
    }
}
