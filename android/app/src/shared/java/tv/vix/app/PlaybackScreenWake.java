package tv.vix.app;

import android.app.Activity;
import android.view.View;
import android.view.WindowManager;

/** Evita que la pantalla se apague durante reproducción de video. */
public final class PlaybackScreenWake {
    private PlaybackScreenWake() {}

    public static void keepOn(Activity activity, View anchor) {
        if (activity != null && !activity.isFinishing()) {
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
        if (anchor != null) anchor.setKeepScreenOn(true);
    }

    public static void release(Activity activity, View anchor) {
        if (anchor != null) anchor.setKeepScreenOn(false);
        if (activity != null && !activity.isFinishing()) {
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }
}
