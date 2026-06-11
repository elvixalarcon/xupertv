package tv.vix.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class TvLoginActivity extends AppCompatActivity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private EditText userInput;
    private EditText passInput;
    private TextView errorText;
    private Button loginBtn;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_tv_login);
        ServerUrlHelper.ensureDefault(getSharedPreferences(AppConstants.PREFS, MODE_PRIVATE));

        userInput = findViewById(R.id.tv_login_user);
        passInput = findViewById(R.id.tv_login_pass);
        errorText = findViewById(R.id.tv_login_error);
        loginBtn = findViewById(R.id.tv_login_btn);

        loginBtn.setOnClickListener(v -> doLogin());
        userInput.requestFocus();
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
                startActivity(new Intent(TvLoginActivity.this, TvShellActivity.class));
                finish();
            });
        });
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN && isEnterKey(event.getKeyCode())) {
            if (loginBtn != null) {
                loginBtn.performClick();
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private boolean isEnterKey(int code) {
        return code == KeyEvent.KEYCODE_DPAD_CENTER
            || code == KeyEvent.KEYCODE_ENTER
            || code == KeyEvent.KEYCODE_NUMPAD_ENTER
            || code == KeyEvent.KEYCODE_BUTTON_A;
    }

    @Override
    protected void onDestroy() {
        executor.shutdown();
        super.onDestroy();
    }
}
