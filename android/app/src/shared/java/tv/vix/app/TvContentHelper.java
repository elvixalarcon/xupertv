package tv.vix.app;

import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

import org.json.JSONObject;

public final class TvContentHelper {
    private TvContentHelper() {}

    public static void open(Context ctx, JSONObject item) {
        String type = item.optString("content_type", item.optString("type", "movie"));
        int id = item.optInt("content_id", item.optInt("id", 0));
        if ("series".equals(type)) {
            Intent i = VixDetailRoutes.seriesDetailIntent(ctx, id);
            TvPreviewExtras.put(
                i,
                item.optString("title", ""),
                item.optString("banner", ""),
                item.optString("backdrop", ""),
                item.optString("poster", "")
            );
            ctx.startActivity(i);
            if (ctx instanceof android.app.Activity) {
                TvPreviewExtras.applyInstantTransition((android.app.Activity) ctx);
            }
            return;
        }
        if ("episode".equals(type)) {
            String path = item.optString("video_path", "");
            if (path.isEmpty()) {
                Toast.makeText(ctx, "Video no disponible", Toast.LENGTH_SHORT).show();
                return;
            }
            Intent i = new Intent(ctx, TvPlayerActivity.class);
            i.putExtra(TvPlayerActivity.EXTRA_TITLE, item.optString("title", ""));
            i.putExtra(TvPlayerActivity.EXTRA_VIDEO_PATH, path);
            i.putExtra(TvPlayerActivity.EXTRA_START_SEC, (long) item.optDouble("progress", 0));
            i.putExtra(TvPlayerActivity.EXTRA_CONTENT_TYPE, "episode");
            i.putExtra(TvPlayerActivity.EXTRA_CONTENT_ID, id);
            i.putExtra(TvPlayerActivity.EXTRA_SERIES_ID, item.optInt("series_id", 0));
            TvPreviewExtras.put(
                i,
                item.optString("title", ""),
                item.optString("banner", ""),
                item.optString("backdrop", ""),
                item.optString("poster", "")
            );
            ctx.startActivity(i);
            if (ctx instanceof android.app.Activity) {
                TvPreviewExtras.applyInstantTransition((android.app.Activity) ctx);
            }
            return;
        }
        if ("movie".equals(type) || "movies".equals(type)) {
            Intent i = VixDetailRoutes.movieDetailIntent(ctx, id);
            TvPreviewExtras.put(
                i,
                item.optString("title", ""),
                item.optString("banner", ""),
                item.optString("backdrop", ""),
                item.optString("poster", "")
            );
            ctx.startActivity(i);
            if (ctx instanceof android.app.Activity) {
                TvPreviewExtras.applyInstantTransition((android.app.Activity) ctx);
            }
            return;
        }
        if ("live".equals(type)) {
            if (id <= 0) {
                Toast.makeText(ctx, "Canal no disponible", Toast.LENGTH_SHORT).show();
                return;
            }
            if (isTvShell(ctx)) {
                try {
                    ctx.getClass().getMethod("tuneLiveChannel", int.class).invoke(ctx, id);
                    return;
                } catch (Exception ignored) { /* abrir reproductor */ }
            }
            CatalogNavigator.openLive(ctx, id, item.optString("title", "En vivo"));
        }
    }

    private static boolean isTvShell(Context ctx) {
        return "tv.vix.app.TvShellActivity".equals(ctx.getClass().getName());
    }
}
