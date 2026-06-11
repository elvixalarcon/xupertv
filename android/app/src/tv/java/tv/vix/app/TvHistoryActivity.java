package tv.vix.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;

public class TvHistoryActivity extends AppCompatActivity {
    public static final String EXTRA_TAB = "tab";
    public static final int TAB_HISTORY = 0;
    public static final int TAB_FAV = 1;
    public static final int TAB_LIST = 2;

    private final List<JSONObject> items = new ArrayList<>();
    private int currentTab = TAB_HISTORY;
    private TextView tabHistory, tabFav, tabList, titleView, totalView, emptyView;
    private ProgressBar loading;
    private ItemAdapter adapter;
    private String serverBase = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_tv_history);
        serverBase = ServerUrlHelper.fromPrefs(getSharedPreferences(AppConstants.PREFS, MODE_PRIVATE));
        currentTab = getIntent().getIntExtra(EXTRA_TAB, TAB_HISTORY);

        tabHistory = findViewById(R.id.tv_hist_tab_history);
        tabFav = findViewById(R.id.tv_hist_tab_fav);
        tabList = findViewById(R.id.tv_hist_tab_list);
        titleView = findViewById(R.id.tv_hist_title);
        totalView = findViewById(R.id.tv_hist_total);
        emptyView = findViewById(R.id.tv_hist_empty);
        loading = findViewById(R.id.tv_hist_loading);
        RecyclerView list = findViewById(R.id.tv_hist_list);
        list.setLayoutManager(new GridLayoutManager(this, 5));
        adapter = new ItemAdapter();
        list.setAdapter(adapter);

        tabHistory.setOnClickListener(v -> selectTab(TAB_HISTORY));
        tabFav.setOnClickListener(v -> selectTab(TAB_FAV));
        tabList.setOnClickListener(v -> selectTab(TAB_LIST));
        selectTab(currentTab);
    }

    private void selectTab(int tab) {
        currentTab = tab;
        highlightTab(tabHistory, tab == TAB_HISTORY);
        highlightTab(tabFav, tab == TAB_FAV);
        highlightTab(tabList, tab == TAB_LIST);
        String title = "Historia";
        if (tab == TAB_FAV) title = "Mi favoritos";
        if (tab == TAB_LIST) title = "Mi lista";
        titleView.setText(title);
        loadTab();
    }

    private void highlightTab(TextView tv, boolean active) {
        tv.setSelected(active);
        tv.setTextColor(ContextCompat.getColor(this, active ? R.color.tv_accent : R.color.tv_text_dim));
    }

    private void loadTab() {
        loading.setVisibility(View.VISIBLE);
        emptyView.setVisibility(View.GONE);
        items.clear();
        adapter.notifyDataSetChanged();
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                VixApi api = new VixApi(this);
                JSONArray arr;
                if (currentTab == TAB_FAV) arr = api.favorites();
                else if (currentTab == TAB_LIST) arr = api.watchlist();
                else arr = api.watchHistory();
                List<JSONObject> list = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    if (currentTab == TAB_HISTORY) {
                        list.add(o);
                    } else {
                        JSONObject wrap = new JSONObject();
                        wrap.put("content_type", o.optString("type", "movie"));
                        wrap.put("content_id", o.optInt("id", 0));
                        wrap.put("title", o.optString("title", ""));
                        wrap.put("poster", o.optString("poster", ""));
                        list.add(wrap);
                    }
                }
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    items.addAll(list);
                    adapter.notifyDataSetChanged();
                    totalView.setText("Total " + list.size());
                    emptyView.setVisibility(list.isEmpty() ? View.VISIBLE : View.GONE);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    emptyView.setVisibility(View.VISIBLE);
                    Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private class ItemAdapter extends RecyclerView.Adapter<ItemAdapter.H> {
        @NonNull
        @Override
        public H onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            return new H(getLayoutInflater().inflate(R.layout.item_tv_history, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            JSONObject item = items.get(position);
            holder.title.setText(item.optString("title", ""));
            String label = item.optString("progress_label", "");
            holder.progress.setVisibility(label.isEmpty() ? View.GONE : View.VISIBLE);
            holder.progress.setText(label);
            Glide.with(TvHistoryActivity.this).load(PlayUrls.poster(serverBase, item.optString("poster", "")))
                .centerCrop().into(holder.poster);
            holder.itemView.setOnClickListener(v -> TvContentHelper.open(TvHistoryActivity.this, item));
        }

        @Override
        public int getItemCount() { return items.size(); }

        class H extends RecyclerView.ViewHolder {
            final android.widget.ImageView poster;
            final TextView title;
            final TextView progress;
            H(View v) {
                super(v);
                poster = v.findViewById(R.id.tv_hist_poster);
                title = v.findViewById(R.id.tv_hist_title_item);
                progress = v.findViewById(R.id.tv_hist_progress);
            }
        }
    }
}
