package tv.vix.app;

import android.content.Intent;
import android.os.Bundle;

import androidx.appcompat.app.AppCompatActivity;

/** Punto de entrada móvil: token → perfil o main (sin WebView). */
public class MobileLauncherActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ServerUrlHelper.ensureDefault(getSharedPreferences(AppConstants.PREFS, MODE_PRIVATE));

        boolean updateIntent = getIntent() != null
            && UpdateChecker.ACTION_UPDATE.equals(getIntent().getAction());

        Intent next;
        if (NativeAuth.hasToken(this)) {
            next = NativeAuth.needsProfileSelection(this)
                ? new Intent(this, MobileProfilePickerActivity.class)
                : new Intent(this, MobileMainActivity.class);
        } else {
            next = new Intent(this, MobileLoginActivity.class);
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
