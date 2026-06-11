package tv.vix.app;

import android.view.View;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.Locale;

/** Calificación TMDB en carátulas del catálogo TV. */
public final class TvPosterBind {
    private TvPosterBind() {}

    public static double ratingFromJson(JSONObject o) {
        if (o == null) return 0;
        double r = o.optDouble("rating", 0);
        if (r <= 0) r = o.optDouble("vote_average", 0);
        if (r <= 0) r = o.optDouble("tmdb_rating", 0);
        return r;
    }

    public static void bindRatingBadge(TextView badge, double rating) {
        if (badge == null) return;
        if (rating > 0) {
            badge.setVisibility(View.VISIBLE);
            badge.setText(String.format(Locale.US, "%.1f", rating));
        } else {
            badge.setVisibility(View.GONE);
            badge.setText("");
        }
    }
}
