package tv.vix.app;

import android.content.SharedPreferences;

public final class ServerUrlHelper {
    public static final String OFFICIAL_SERVER = "https://tv.vixred.com";

    private ServerUrlHelper() {}

    public static String normalize(String raw) {
        String base = raw == null ? "" : raw.trim();
        if (base.isEmpty()) return OFFICIAL_SERVER;
        if (!base.startsWith("http://") && !base.startsWith("https://")) {
            base = "https://" + base;
        }
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base;
    }

    public static String fromPrefs(SharedPreferences prefs) {
        String saved = prefs.getString(MainActivity.KEY_SERVER, "").trim();
        if (saved.isEmpty()) return OFFICIAL_SERVER;
        return normalize(saved);
    }

    public static void ensureDefault(SharedPreferences prefs) {
        String saved = prefs.getString(MainActivity.KEY_SERVER, "").trim();
        if (saved.isEmpty()) {
            prefs.edit().putString(MainActivity.KEY_SERVER, OFFICIAL_SERVER).apply();
        }
    }
}
