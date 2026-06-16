package tv.vix.app;

import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

import tv.vix.app.CatalogModels.CatalogItem;

public final class CatalogNavigator {
    private CatalogNavigator() {}

    public static void open(Context ctx, CatalogItem item) {
        if (item == null || ctx == null) return;
        if (item.external) {
            if (item.source.isEmpty() || item.slug.isEmpty()) {
                Toast.makeText(ctx, "Contenido no disponible", Toast.LENGTH_SHORT).show();
                return;
            }
            if (item.isSeries) {
                TvCatalogHelper.openExternalSeries(ctx, item.source, item.slug,
                    item.title, item.banner, item.backdrop, item.poster);
            } else {
                TvCatalogHelper.openExternalMovie(ctx, item.source, item.slug, item.year,
                    item.title, item.banner, item.backdrop, item.poster);
            }
            return;
        }
        if (item.isSeries && "series".equals(item.contentType)) {
            Intent i = VixDetailRoutes.seriesDetailIntent(ctx, item.id);
            TvPreviewExtras.put(i, item.title, item.banner, item.backdrop, item.poster);
            ctx.startActivity(i);
            if (ctx instanceof android.app.Activity) {
                TvPreviewExtras.applyInstantTransition((android.app.Activity) ctx);
            }
            return;
        }
        if ("episode".equals(item.contentType)) {
            if (item.videoPath == null || item.videoPath.isEmpty()) {
                Toast.makeText(ctx, "Video no disponible", Toast.LENGTH_LONG).show();
                return;
            }
            Intent i = new Intent(ctx, TvPlayerActivity.class);
            i.putExtra(TvPlayerActivity.EXTRA_TITLE, item.title);
            i.putExtra(TvPlayerActivity.EXTRA_VIDEO_PATH, item.videoPath);
            i.putExtra(TvPlayerActivity.EXTRA_START_SEC, item.progress);
            i.putExtra(TvPlayerActivity.EXTRA_CONTENT_TYPE, "episode");
            i.putExtra(TvPlayerActivity.EXTRA_CONTENT_ID, item.id);
            i.putExtra(TvPlayerActivity.EXTRA_SERIES_ID, item.seriesId);
            TvPreviewExtras.put(i, item.title, item.banner, item.backdrop, item.poster);
            ctx.startActivity(i);
            if (ctx instanceof android.app.Activity) {
                TvPreviewExtras.applyInstantTransition((android.app.Activity) ctx);
            }
            return;
        }
        Intent i = VixDetailRoutes.movieDetailIntent(ctx, item.id);
        TvPreviewExtras.put(i, item.title, item.banner, item.backdrop, item.poster);
        ctx.startActivity(i);
        if (ctx instanceof android.app.Activity) {
            TvPreviewExtras.applyInstantTransition((android.app.Activity) ctx);
        }
    }

    public static void openLive(Context ctx, int channelId, String channelName) {
        if (channelId <= 0) {
            Toast.makeText(ctx, "Canal no disponible", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent i = new Intent(ctx, TvPlayerActivity.class);
        i.putExtra(TvPlayerActivity.EXTRA_TITLE, channelName != null ? channelName : "En vivo");
        i.putExtra(TvPlayerActivity.EXTRA_LIVE_CHANNEL_ID, channelId);
        ctx.startActivity(i);
    }
}
