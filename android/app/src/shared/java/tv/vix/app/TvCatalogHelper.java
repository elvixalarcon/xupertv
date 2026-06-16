package tv.vix.app;

import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/** Parseo y navegación de ítems del catálogo (incl. fuentes externas en Explorar). */
public final class TvCatalogHelper {
    private TvCatalogHelper() {}

    public static boolean isExternalItem(JSONObject o) {
        if (o == null) return false;
        if (o.optBoolean("external", false)) return true;
        String src = o.optString("source", "");
        String slug = o.optString("slug", "");
        return !src.isEmpty() && !slug.isEmpty() && o.optInt("id", 0) <= 0;
    }

    public static String resolveContentType(JSONObject o, String fallback) {
        if (o == null) return fallback != null ? fallback : "movie";
        String type = o.optString("content_type", "");
        if (type.isEmpty()) type = o.optString("type", "");
        return type.isEmpty() ? (fallback != null ? fallback : "movie") : type;
    }

    public static String externalPlayUrl(String serverBase, JSONObject play) {
        if (play == null) return "";
        String proxied = play.optString("proxied", "");
        if (!proxied.isEmpty()) {
            return proxied.startsWith("/") ? serverBase + proxied : proxied;
        }
        String url = play.optString("url", "");
        if (url.startsWith("/")) return serverBase + url;
        return url;
    }

    public static void openExternalMovie(Context ctx, String source, String slug, int year,
                                         String title, String banner, String backdrop, String poster) {
        Intent i = new Intent(ctx, VixDetailRoutes.movieDetailClass());
        i.putExtra(TvMovieDetailActivity.EXTRA_EXTERNAL_SOURCE, source);
        i.putExtra(TvMovieDetailActivity.EXTRA_EXTERNAL_SLUG, slug);
        if (year > 0) i.putExtra(TvMovieDetailActivity.EXTRA_EXTERNAL_YEAR, year);
        TvPreviewExtras.put(i, title, banner, backdrop, poster);
        ctx.startActivity(i);
        if (ctx instanceof android.app.Activity) {
            TvPreviewExtras.applyInstantTransition((android.app.Activity) ctx);
        }
    }

    public static void openExternalSeries(Context ctx, String source, String slug,
                                          String title, String banner, String backdrop, String poster) {
        Intent i = new Intent(ctx, VixDetailRoutes.seriesDetailClass());
        i.putExtra(TvSeriesDetailActivity.EXTRA_EXTERNAL_SOURCE, source);
        i.putExtra(TvSeriesDetailActivity.EXTRA_EXTERNAL_SLUG, slug);
        TvPreviewExtras.put(i, title, banner, backdrop, poster);
        ctx.startActivity(i);
        if (ctx instanceof android.app.Activity) {
            TvPreviewExtras.applyInstantTransition((android.app.Activity) ctx);
        }
    }
}
