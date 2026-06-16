package tv.vix.app;

import android.content.Context;
import android.content.SharedPreferences;

/** Identificador estable por instalación para conexiones simultáneas en el admin. */
public final class ActivitySession {
    private static final String KEY = "activity_session_key";
    private static final String KEY_PLAYER = "activity_player_session_key";

    private ActivitySession() {}

    public static String key(Context context) {
        return shellKey(context);
    }

    public static String shellKey(Context context) {
        return ensureKey(context, KEY);
    }

    public static String playerKey(Context context) {
        return ensureKey(context, KEY_PLAYER);
    }

    private static String ensureKey(Context context, String storageKey) {
        SharedPreferences prefs = context.getSharedPreferences(AppConstants.PREFS, Context.MODE_PRIVATE);
        String existing = prefs.getString(storageKey, null);
        if (existing != null && !existing.isEmpty()) return existing;
        String prefix = KEY_PLAYER.equals(storageKey) ? "atv" : "and";
        String created = prefix + Long.toString(System.currentTimeMillis(), 36)
            + Integer.toString((int) (Math.random() * 1_000_000), 36);
        prefs.edit().putString(storageKey, created).apply();
        return created;
    }
}
