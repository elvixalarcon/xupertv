package tv.vix.app;

import android.content.Context;
import android.widget.ImageView;

import androidx.annotation.Nullable;

import com.bumptech.glide.Glide;
import com.bumptech.glide.load.engine.DiskCacheStrategy;
import com.bumptech.glide.request.RequestOptions;

/** Carga de portadas con caché en disco y memoria. */
public final class MobileImageLoader {
    private static final RequestOptions POSTER_OPTS = new RequestOptions()
        .diskCacheStrategy(DiskCacheStrategy.ALL)
        .skipMemoryCache(false);

    private MobileImageLoader() {}

    public static void poster(Context ctx, @Nullable ImageView target, @Nullable String url) {
        if (target == null) return;
        if (url == null || url.isEmpty()) {
            target.setImageDrawable(null);
            return;
        }
        Glide.with(ctx).load(url).apply(POSTER_OPTS).centerCrop().into(target);
    }

    public static void posterFit(Context ctx, @Nullable ImageView target, @Nullable String url) {
        if (target == null) return;
        if (url == null || url.isEmpty()) {
            target.setImageDrawable(null);
            return;
        }
        Glide.with(ctx).load(url).apply(POSTER_OPTS).fitCenter().into(target);
    }

    public static void posterPath(Context ctx, @Nullable ImageView target, String serverBase, @Nullable String path) {
        poster(ctx, target, PlayUrls.poster(serverBase, path != null ? path : ""));
    }

    public static void prefetch(Context ctx, @Nullable String url) {
        if (url == null || url.isEmpty()) return;
        Glide.with(ctx.getApplicationContext()).load(url).apply(POSTER_OPTS).preload();
    }

    public static void clearMemory(Context ctx) {
        Glide.get(ctx.getApplicationContext()).clearMemory();
    }
}
