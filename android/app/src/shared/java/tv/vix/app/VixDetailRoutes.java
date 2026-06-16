package tv.vix.app;

import android.app.Activity;
import android.content.Intent;

@SuppressWarnings("unchecked")
public final class VixDetailRoutes {
    private VixDetailRoutes() {}

    public static Class<? extends Activity> movieDetailClass() {
        if ("mobile".equals(BuildConfig.PLATFORM)) {
            return loadClass("tv.vix.app.MobileMovieDetailActivity");
        }
        return TvMovieDetailActivity.class;
    }

    public static Class<? extends Activity> seriesDetailClass() {
        if ("mobile".equals(BuildConfig.PLATFORM)) {
            return loadClass("tv.vix.app.MobileSeriesDetailActivity");
        }
        return TvSeriesDetailActivity.class;
    }

    public static Intent movieDetailIntent(android.content.Context ctx, int movieId) {
        Intent i = new Intent(ctx, movieDetailClass());
        i.putExtra(TvMovieDetailActivity.EXTRA_MOVIE_ID, movieId);
        return i;
    }

    public static Intent seriesDetailIntent(android.content.Context ctx, int seriesId) {
        Intent i = new Intent(ctx, seriesDetailClass());
        i.putExtra(TvSeriesDetailActivity.EXTRA_SERIES_ID, seriesId);
        return i;
    }

    private static Class<? extends Activity> loadClass(String name) {
        try {
            return (Class<? extends Activity>) Class.forName(name);
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException("Activity not found: " + name, e);
        }
    }
}
