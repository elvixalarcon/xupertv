package tv.vix.app;

import android.content.Intent;
import android.os.Bundle;

import androidx.appcompat.app.AppCompatActivity;

/** Redirige al flujo nativo TV (sin WebView). */
public class TvLauncherActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ServerUrlHelper.ensureDefault(getSharedPreferences(AppConstants.PREFS, MODE_PRIVATE));
        if (NativeAuth.hasToken(this)) {
            startActivity(new Intent(this, TvShellActivity.class));
        } else {
            startActivity(new Intent(this, TvLoginActivity.class));
        }
        finish();
    }
}
