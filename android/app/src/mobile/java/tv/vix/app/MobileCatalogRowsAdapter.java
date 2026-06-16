package tv.vix.app;

import android.content.Context;
import android.content.Intent;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

import tv.vix.app.CatalogModels.CatalogItem;
import tv.vix.app.CatalogModels.CatalogRow;

public final class MobileCatalogRowsAdapter extends RecyclerView.Adapter<MobileCatalogRowsAdapter.RowH> {
    private final List<CatalogRow> rows = new ArrayList<>();
    private final Context ctx;

    public MobileCatalogRowsAdapter(Context ctx) {
        this.ctx = ctx;
    }

    public void setRows(List<CatalogRow> list) {
        rows.clear();
        if (list != null) rows.addAll(list);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public RowH onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext())
            .inflate(R.layout.item_mobile_catalog_row, parent, false);
        return new RowH(v);
    }

    @Override
    public void onBindViewHolder(@NonNull RowH holder, int position) {
        CatalogRow row = rows.get(position);
        holder.title.setText(row.label);
        if (row.continueRow) {
            holder.subtitle.setVisibility(View.VISIBLE);
            holder.subtitle.setText("Continúa donde lo dejaste");
        } else {
            holder.subtitle.setVisibility(View.GONE);
        }
        MobilePosterAdapter posterAdapter = new MobilePosterAdapter(ctx,
            item -> CatalogNavigator.open(ctx, item));
        holder.list.setLayoutManager(new LinearLayoutManager(ctx, LinearLayoutManager.HORIZONTAL, false));
        holder.list.setAdapter(posterAdapter);
        posterAdapter.setItems(row.items);
        holder.list.setNestedScrollingEnabled(false);
    }

    @Override
    public int getItemCount() {
        return rows.size();
    }

    static class RowH extends RecyclerView.ViewHolder {
        final TextView title;
        final TextView subtitle;
        final RecyclerView list;

        RowH(View itemView) {
            super(itemView);
            title = itemView.findViewById(R.id.mobile_row_title);
            subtitle = itemView.findViewById(R.id.mobile_row_subtitle);
            list = itemView.findViewById(R.id.mobile_row_list);
        }
    }
}
