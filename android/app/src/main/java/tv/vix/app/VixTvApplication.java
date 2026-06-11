package tv.vix.app;

import android.app.Application;

/** Sin precarga de WebView (evita crash en TV box sin Google WebView). */
public class VixTvApplication extends Application {
    public static boolean isWebViewAvailable() {
        return false;
    }

    @Override
    public void onCreate() {
        super.onCreate();
    }
}
