package tv.vix.app;

import android.app.Activity;
import android.content.Intent;

public final class VixAuthRoutes {
    private VixAuthRoutes() {}

    public static Class<?> loginActivityClass() {
        if ("mobile".equals(BuildConfig.PLATFORM)) {
            return loadClass("tv.vix.app.MobileLoginActivity");
        }
        return loadClass("tv.vix.app.TvLoginActivity");
    }

    public static Class<?> mainActivityClass() {
        if ("mobile".equals(BuildConfig.PLATFORM)) {
            return loadClass("tv.vix.app.MobileMainActivity");
        }
        return loadClass("tv.vix.app.TvShellActivity");
    }

    public static Class<?> launcherActivityClass() {
        if ("mobile".equals(BuildConfig.PLATFORM)) {
            return loadClass("tv.vix.app.MobileLauncherActivity");
        }
        return loadClass("tv.vix.app.TvLauncherActivity");
    }

    public static void startLogin(Activity activity) {
        Intent i = new Intent(activity, loginActivityClass());
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(i);
        activity.finish();
    }

    public static void startMain(Activity activity) {
        Intent i = new Intent(activity, mainActivityClass());
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(i);
        activity.finish();
    }

    @SuppressWarnings("unchecked")
    private static Class<? extends Activity> loadClass(String name) {
        try {
            return (Class<? extends Activity>) Class.forName(name);
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException("Activity not found: " + name, e);
        }
    }
}
