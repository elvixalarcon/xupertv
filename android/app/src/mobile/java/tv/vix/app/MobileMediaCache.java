package tv.vix.app;

import android.content.Context;
import android.net.Uri;

import androidx.annotation.Nullable;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;

import java.io.File;

/** Caché en disco para streams de tráiler (HLS/MP4 vía ExoPlayer SimpleCache). */
public final class MobileMediaCache {
    private static final long MAX_BYTES = 200L * 1024L * 1024L; // 200 MB
    private static volatile SimpleCache cache;
    private static volatile StandaloneDatabaseProvider dbProvider;

    private MobileMediaCache() {}

    public static SimpleCache get(Context context) {
        if (cache == null) {
            synchronized (MobileMediaCache.class) {
                if (cache == null) {
                    Context app = context.getApplicationContext();
                    dbProvider = new StandaloneDatabaseProvider(app);
                    File dir = new File(app.getCacheDir(), "vix_trailers");
                    if (!dir.exists()) dir.mkdirs();
                    cache = new SimpleCache(dir, new LeastRecentlyUsedCacheEvictor(MAX_BYTES), dbProvider);
                }
            }
        }
        return cache;
    }

    public static DataSource.Factory dataSourceFactory(Context context, @Nullable String authToken) {
        DefaultHttpDataSource.Factory upstream = new DefaultHttpDataSource.Factory()
            .setUserAgent("VixTV/1.0 mobile")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(12000)
            .setReadTimeoutMs(20000);
        if (authToken != null && !authToken.isEmpty()) {
            upstream.setDefaultRequestProperties(
                java.util.Collections.singletonMap("Authorization", "Bearer " + authToken));
        }
        return new CacheDataSource.Factory()
            .setCache(get(context))
            .setUpstreamDataSourceFactory(upstream)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
    }

    public static void release() {
        synchronized (MobileMediaCache.class) {
            if (cache != null) {
                try {
                    cache.release();
                } catch (Exception ignored) { }
                cache = null;
            }
            dbProvider = null;
        }
    }
}
