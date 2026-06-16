package tv.vix.app;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

import tv.vix.app.CatalogModels.CatalogItem;

public final class MobilePosterAdapter extends RecyclerView.Adapter<MobilePosterAdapter.H> {
    public interface Listener {
        void onItemClick(CatalogItem item);
    }

    private final List<CatalogItem> items = new ArrayList<>();
    private final String serverBase;
    private final Listener listener;

    public MobilePosterAdapter(Context ctx, Listener listener) {
        this.serverBase = ServerUrlHelper.fromPrefs(
            ctx.getSharedPreferences(AppConstants.PREFS, Context.MODE_PRIVATE));
        this.listener = listener;
    }

    public void setItems(List<CatalogItem> list) {
        items.clear();
        if (list != null) items.addAll(list);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public H onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext())
            .inflate(R.layout.item_mobile_poster, parent, false);
        return new H(v);
    }

    @Override
    public void onBindViewHolder(@NonNull H holder, int position) {
        CatalogItem item = items.get(position);
        holder.title.setText(item.title);
        TvPosterBind.bindRatingBadge(holder.rating, item.rating);
        String url = PlayUrls.posterForItem(serverBase, item.title, item.year, item.poster);
        MobileImageLoader.poster(holder.image.getContext(), holder.image, url);
        if (item.progress > 0 && item.duration > 0) {
            holder.progressBar.setVisibility(View.VISIBLE);
            holder.itemView.post(() -> {
                int pct = (int) Math.min(100, (item.progress * 100) / item.duration);
                ViewGroup.LayoutParams lp = holder.progressFill.getLayoutParams();
                lp.width = holder.progressBar.getWidth() * pct / 100;
                holder.progressFill.setLayoutParams(lp);
            });
        } else {
            holder.progressBar.setVisibility(View.GONE);
        }
        holder.itemView.setOnClickListener(v -> {
            if (listener != null) listener.onItemClick(item);
        });
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static class H extends RecyclerView.ViewHolder {
        final ImageView image;
        final TextView title;
        final TextView rating;
        final FrameLayout progressBar;
        final View progressFill;

        H(View itemView) {
            super(itemView);
            image = itemView.findViewById(R.id.mobile_poster_img);
            title = itemView.findViewById(R.id.mobile_poster_title);
            rating = itemView.findViewById(R.id.mobile_poster_rating);
            progressBar = itemView.findViewById(R.id.mobile_poster_progress_bar);
            progressFill = itemView.findViewById(R.id.mobile_poster_progress_fill);
        }
    }
}
