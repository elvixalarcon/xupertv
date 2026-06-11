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
            Intent next = NativeAuth.needsProfileSelection(this)
                ? new Intent(this, TvProfilePickerActivity.class)
                : new Intent(this, TvShellActivity.class);
            startActivity(next);
        } else {
            startActivity(new Intent(this, TvLoginActivity.class));
        }
        finish();
    }
}
