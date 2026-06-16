package tv.vix.app;

import android.app.Activity;
import android.content.Intent;
import android.widget.Toast;

public final class TvSessionHelper {
    private TvSessionHelper() {}

    public static boolean isAuthError(Throwable error) {
        return error instanceof VixApi.ApiException
            && ((VixApi.ApiException) error).code == 401;
    }

    public static void redirectToLogin(Activity activity, String message) {
        if (activity == null || activity.isFinishing()) return;
        NativeAuth.clearToken(activity);
        String msg = message == null || message.trim().isEmpty()
            ? "Sesión expirada. Ingresa de nuevo."
            : message.trim();
        Toast.makeText(activity, msg, Toast.LENGTH_LONG).show();
        Intent login = new Intent(activity, VixAuthRoutes.loginActivityClass());
        login.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(login);
        activity.finish();
    }
}
