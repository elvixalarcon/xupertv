package tv.vix.app;

import android.content.Intent;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MobileLoginActivity extends AppCompatActivity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private EditText userInput;
    private EditText passInput;
    private TextView errorText;
    private Button loginBtn;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_mobile_login);
        ServerUrlHelper.ensureDefault(getSharedPreferences(AppConstants.PREFS, MODE_PRIVATE));

        userInput = findViewById(R.id.mobile_login_user);
        passInput = findViewById(R.id.mobile_login_pass);
        errorText = findViewById(R.id.mobile_login_error);
        loginBtn = findViewById(R.id.mobile_login_btn);
        loginBtn.setOnClickListener(v -> doLogin());
        requestUpdatePermissionIfNeeded();
        UpdateChecker.checkAsync(this);
        UpdateChecker.handleUpdateIntent(this, getIntent());
    }

    private void requestUpdatePermissionIfNeeded() {
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            if (androidx.core.content.ContextCompat.checkSelfPermission(this,
                    android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                androidx.core.app.ActivityCompat.requestPermissions(
                    this, new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 9003);
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        UpdateChecker.handleUpdateIntent(this, intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        UpdateChecker.checkAsync(this);
    }

    private void doLogin() {
        String user = userInput.getText().toString().trim();
        String pass = passInput.getText().toString();
        if (user.isEmpty() || pass.isEmpty()) {
            errorText.setText("Escribe usuario y contraseña");
            return;
        }
        loginBtn.setEnabled(false);
        errorText.setText(getString(R.string.native_login_connecting));
        final android.content.Context app = getApplicationContext();
        executor.execute(() -> {
            NativeAuth.Result result = NativeAuth.login(app, user, pass);
            if (!result.ok) {
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    loginBtn.setEnabled(true);
                    errorText.setText(result.error);
                });
                return;
            }
            NativeAuth.saveToken(app, result.token);
            if (result.needsProfileSetup) {
                try {
                    VixApi api = new VixApi(app);
                    org.json.JSONObject setup = api.setupProfile(user);
                    String newToken = setup.optString("token", "");
                    if (!newToken.isEmpty()) NativeAuth.saveToken(app, newToken);
                } catch (Exception e) {
                    runOnUiThread(() -> {
                        if (isFinishing()) return;
                        loginBtn.setEnabled(true);
                        errorText.setText(e.getMessage() != null ? e.getMessage() : "Error al crear perfil");
                    });
                    return;
                }
            }
            runOnUiThread(() -> {
                if (isFinishing()) return;
                Intent next;
                if (result.needsProfilePick || NativeAuth.needsProfileSelection(app)) {
                    next = new Intent(MobileLoginActivity.this, MobileProfilePickerActivity.class);
                } else {
                    next = new Intent(MobileLoginActivity.this, MobileMainActivity.class);
                }
                startActivity(next);
                finish();
            });
        });
    }

    @Override
    protected void onDestroy() {
        executor.shutdown();
        super.onDestroy();
    }
}
