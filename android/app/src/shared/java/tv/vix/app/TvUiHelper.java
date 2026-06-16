package tv.vix.app;

import android.view.View;
import android.view.ViewGroup;

import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

/** Utilidades de UI para Android TV. */
public final class TvUiHelper {
    private TvUiHelper() {}

    /**
     * RecyclerView dentro de ScrollView con height=wrap_content solo muestra ~1 pantalla de ítems.
     * Mide todos los hijos y fija la altura para listar temporadas/episodios completos.
     */
    public static void expandRecyclerViewHeight(RecyclerView rv) {
        if (rv == null) return;
        RecyclerView.Adapter adapter = rv.getAdapter();
        RecyclerView.LayoutManager lm = rv.getLayoutManager();
        if (adapter == null || !(lm instanceof LinearLayoutManager)) return;

        int width = rv.getWidth();
        if (width <= 0) {
            rv.post(() -> expandRecyclerViewHeight(rv));
            return;
        }

        int widthSpec = View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY);
        int height = 0;
        for (int i = 0; i < adapter.getItemCount(); i++) {
            int viewType = adapter.getItemViewType(i);
            RecyclerView.ViewHolder holder = adapter.createViewHolder(rv, viewType);
            adapter.onBindViewHolder(holder, i);
            View item = holder.itemView;
            item.measure(
                widthSpec,
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
            );
            height += item.getMeasuredHeight();
            ViewGroup.LayoutParams lp = item.getLayoutParams();
            if (lp instanceof ViewGroup.MarginLayoutParams) {
                ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) lp;
                height += mlp.topMargin + mlp.bottomMargin;
            }
        }

        ViewGroup.LayoutParams params = rv.getLayoutParams();
        params.height = height;
        rv.setLayoutParams(params);
        rv.requestLayout();
    }
}
