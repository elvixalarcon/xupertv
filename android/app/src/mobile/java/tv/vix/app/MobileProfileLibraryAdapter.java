package tv.vix.app;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public final class MobileProfileLibraryAdapter extends RecyclerView.Adapter<MobileProfileLibraryAdapter.H> {
    public interface Listener {
        void onItemClick(JSONObject item);
    }

    private final List<JSONObject> items = new ArrayList<>();
    private final String serverBase;
    private final Listener listener;
    private String emptyText = "";

    public MobileProfileLibraryAdapter(Context ctx, Listener listener) {
        this.serverBase = ServerUrlHelper.fromPrefs(
            ctx.getSharedPreferences(AppConstants.PREFS, Context.MODE_PRIVATE));
        this.listener = listener;
    }

    public void setItems(List<JSONObject> list, String empty) {
        items.clear();
        emptyText = empty != null ? empty : "";
        if (list != null) items.addAll(list);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public H onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext())
            .inflate(R.layout.item_mobile_library, parent, false);
        return new H(v);
    }

    @Override
    public void onBindViewHolder(@NonNull H holder, int position) {
        if (items.isEmpty()) {
            holder.poster.setVisibility(View.GONE);
            holder.title.setText(emptyText);
            holder.subtitle.setText("");
            holder.itemView.setOnClickListener(null);
            return;
        }
        JSONObject item = items.get(position);
        holder.poster.setVisibility(View.VISIBLE);
        String title = item.optString("title", "");
        String type = item.optString("content_type", item.optString("type", "movie"));
        if ("episode".equals(type)) {
            title = item.optString("series_title", "") + " · " + title;
        }
        holder.title.setText(title);
        String sub = item.optString("progress_label", "");
        if (sub.isEmpty()) {
            if ("series".equals(type)) sub = "Serie";
            else if ("movie".equals(type)) sub = "Película";
            else sub = item.optString("subtitle", "");
        }
        holder.subtitle.setText(sub);
        String url = PlayUrls.poster(serverBase, item.optString("poster", ""));
        MobileImageLoader.poster(holder.poster.getContext(), holder.poster, url);
        holder.itemView.setOnClickListener(v -> {
            if (listener != null) listener.onItemClick(item);
        });
    }

    @Override
    public int getItemCount() {
        return items.isEmpty() ? 1 : items.size();
    }

    static class H extends RecyclerView.ViewHolder {
        final ImageView poster;
        final TextView title;
        final TextView subtitle;

        H(View itemView) {
            super(itemView);
            poster = itemView.findViewById(R.id.mobile_lib_poster);
            title = itemView.findViewById(R.id.mobile_lib_title);
            subtitle = itemView.findViewById(R.id.mobile_lib_subtitle);
        }
    }
}
