package tv.vix.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

public class VixJsBridge {
    private final MainActivity activity;

    public VixJsBridge(MainActivity activity) {
        this.activity = activity;
    }

    private SharedPreferences prefs() {
        return activity.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public void showToast(String message) {
        if (message == null || message.trim().isEmpty()) return;
        activity.runOnUiThread(() ->
            Toast.makeText(activity, message.trim(), Toast.LENGTH_LONG).show()
        );
    }

    @JavascriptInterface
    public void showKeyboard() {
        activity.runOnUiThread(() -> {
            InputMethodManager imm = (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) {
                imm.showSoftInput(activity.getCurrentFocus(), InputMethodManager.SHOW_IMPLICIT);
            }
        });
    }

    @JavascriptInterface
    public String getAuthToken() {
        return NativeAuth.getToken(activity);
    }

    @JavascriptInterface
    public void saveAuthToken(String value) {
        NativeAuth.saveToken(activity, value);
    }

    @JavascriptInterface
    public void clearAuthToken() {
        NativeAuth.clearToken(activity);
        if (BuildConfig.PLATFORM.equals("tv")) {
            activity.runOnUiThread(() -> activity.showNativeLogin("Sesión cerrada"));
        }
    }

    @JavascriptInterface
    public void nativeLogin(String username, String password) {
        activity.runOnUiThread(() -> activity.performNativeLogin(username, password, false));
    }

    @JavascriptInterface
    public void notifyNativeBootComplete() {
        activity.runOnUiThread(activity::onWebBootComplete);
    }

    @JavascriptInterface
    public void notifyNativeBootFailed(String message) {
        activity.runOnUiThread(() -> activity.onWebBootFailed(message));
    }

    @JavascriptInterface
    public void downloadUpdate(String downloadUrl) {
        activity.runOnUiThread(() -> {
            if (downloadUrl == null || downloadUrl.trim().isEmpty()) {
                Toast.makeText(activity, R.string.update_download_failed, Toast.LENGTH_SHORT).show();
                return;
            }
            UpdateChecker.startDownload(activity, downloadUrl.trim());
        });
    }
}
