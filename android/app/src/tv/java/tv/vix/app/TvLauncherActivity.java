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

        boolean updateIntent = getIntent() != null
            && UpdateChecker.ACTION_UPDATE.equals(getIntent().getAction());

        Intent next;
        if (NativeAuth.hasToken(this)) {
            next = NativeAuth.needsProfileSelection(this)
                ? new Intent(this, TvProfilePickerActivity.class)
                : new Intent(this, TvShellActivity.class);
        } else {
            next = new Intent(this, TvLoginActivity.class);
        }
        if (updateIntent) {
            next.setAction(getIntent().getAction());
            if (getIntent().getExtras() != null) next.putExtras(getIntent());
            next.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        }
        startActivity(next);
        finish();
    }
}
