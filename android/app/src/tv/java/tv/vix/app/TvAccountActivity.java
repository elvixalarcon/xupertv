package tv.vix.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;

public class TvAccountActivity extends AppCompatActivity {
    private final List<JSONObject> historyItems = new ArrayList<>();
    private HistoryAdapter adapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_tv_account);

        ProgressBar loading = findViewById(R.id.tv_account_loading);
        TextView accountId = findViewById(R.id.tv_account_id);
        TextView accountUser = findViewById(R.id.tv_account_user);
        RecyclerView historyList = findViewById(R.id.tv_account_history);
        historyList.setLayoutManager(new LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false));
        adapter = new HistoryAdapter();
        historyList.setAdapter(adapter);

        findViewById(R.id.tv_hub_favorites).setOnClickListener(v ->
            startActivity(new Intent(this, TvHistoryActivity.class)
                .putExtra(TvHistoryActivity.EXTRA_TAB, TvHistoryActivity.TAB_FAV)));
        findViewById(R.id.tv_hub_list).setOnClickListener(v ->
            startActivity(new Intent(this, TvHistoryActivity.class)
                .putExtra(TvHistoryActivity.EXTRA_TAB, TvHistoryActivity.TAB_LIST)));
        findViewById(R.id.tv_hub_functions).setOnClickListener(v ->
            startActivity(new Intent(this, TvFunctionsActivity.class)));
        findViewById(R.id.tv_hub_history).setOnClickListener(v ->
            startActivity(new Intent(this, TvHistoryActivity.class)));

        Button logout = findViewById(R.id.tv_account_logout);
        Button switchAcc = findViewById(R.id.tv_account_switch);
        logout.setOnClickListener(v -> {
            NativeAuth.clearToken(this);
            startActivity(new Intent(this, TvLoginActivity.class));
            finishAffinity();
        });
        switchAcc.setOnClickListener(v -> logout.performClick());

        loading.setVisibility(View.VISIBLE);
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                JSONObject me = new VixApi(this).me();
                JSONArray hist = new VixApi(this).watchHistory();
                List<JSONObject> list = new ArrayList<>();
                for (int i = 0; i < hist.length(); i++) list.add(hist.getJSONObject(i));
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    String user = me.optString("username", "");
                    accountId.setText(user.isEmpty() ? "Mi cuenta" : user);
                    String email = me.optString("email", "");
                    if (email.isEmpty()) {
                        accountUser.setText("Perfil Vix TV");
                    } else {
                        accountUser.setText(maskEmail(email));
                    }
                    historyItems.clear();
                    historyItems.addAll(list);
                    adapter.notifyDataSetChanged();
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private static String maskEmail(String email) {
        int at = email.indexOf('@');
        if (at <= 1) return email;
        return email.substring(0, Math.min(3, at)) + "***" + email.substring(at);
    }

    private class HistoryAdapter extends RecyclerView.Adapter<HistoryAdapter.H> {
        @NonNull
        @Override
        public H onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            return new H(getLayoutInflater().inflate(R.layout.item_tv_history, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            JSONObject item = historyItems.get(position);
            holder.title.setText(item.optString("title", ""));
            holder.progress.setText(item.optString("progress_label", ""));
            String poster = item.optString("poster", "");
            Glide.with(TvAccountActivity.this).load(PlayUrls.poster(
                ServerUrlHelper.fromPrefs(getSharedPreferences(AppConstants.PREFS, MODE_PRIVATE)), poster))
                .centerCrop().into(holder.poster);
            holder.itemView.setOnClickListener(v -> TvContentHelper.open(TvAccountActivity.this, item));
        }

        @Override
        public int getItemCount() { return historyItems.size(); }

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
