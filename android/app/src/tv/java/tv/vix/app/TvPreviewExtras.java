package tv.vix.app;

import android.content.Intent;

public final class TvPreviewExtras {
    public static final String EXTRA_PREVIEW_IMAGE = "preview_image";
    public static final String EXTRA_PREFILL_TITLE = "prefill_title";

    private TvPreviewExtras() {}

    public static String pickImage(String banner, String backdrop, String poster) {
        if (banner != null && !banner.isEmpty()) return banner;
        if (backdrop != null && !backdrop.isEmpty()) return backdrop;
        return poster != null ? poster : "";
    }

    public static void put(Intent intent, String title, String banner, String backdrop, String poster) {
        String img = pickImage(banner, backdrop, poster);
        if (!img.isEmpty()) intent.putExtra(EXTRA_PREVIEW_IMAGE, img);
        if (title != null && !title.isEmpty()) intent.putExtra(EXTRA_PREFILL_TITLE, title);
    }

    public static void applyInstantTransition(android.app.Activity activity) {
        if (activity != null) activity.overridePendingTransition(0, 0);
    }
}
