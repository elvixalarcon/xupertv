package tv.vix.app;

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

public class TvChangePasswordActivity extends AppCompatActivity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private EditText currentInput;
    private EditText newInput;
    private EditText confirmInput;
    private TextView errorText;
    private Button saveBtn;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_tv_change_password);

        TextView userLabel = findViewById(R.id.tv_change_pass_user);
        currentInput = findViewById(R.id.tv_change_pass_current);
        newInput = findViewById(R.id.tv_change_pass_new);
        confirmInput = findViewById(R.id.tv_change_pass_confirm);
        errorText = findViewById(R.id.tv_change_pass_error);
        saveBtn = findViewById(R.id.tv_change_pass_save);
        Button cancelBtn = findViewById(R.id.tv_change_pass_cancel);

        String username = getIntent().getStringExtra(TvChangePasswordActivity.EXTRA_USERNAME);
        if (username == null || username.isEmpty()) {
            username = NativeAuth.getUsername(this);
        }
        userLabel.setText(username.isEmpty() ? "Mi cuenta" : ("Usuario: " + username));

        saveBtn.setOnClickListener(v -> savePassword());
        cancelBtn.setOnClickListener(v -> finish());
        currentInput.requestFocus();
    }

    public static final String EXTRA_USERNAME = "username";

    private void savePassword() {
        String current = currentInput.getText().toString();
        String next = newInput.getText().toString();
        String confirm = confirmInput.getText().toString();
        errorText.setText("");

        if (current.isEmpty() || next.isEmpty() || confirm.isEmpty()) {
            errorText.setText("Completa todos los campos");
            return;
        }
        if (!next.equals(confirm)) {
            errorText.setText("Las contraseñas nuevas no coinciden");
            return;
        }
        if (next.length() < 4) {
            errorText.setText("Mínimo 4 caracteres");
            return;
        }

        saveBtn.setEnabled(false);
        executor.execute(() -> {
            try {
                new VixApi(this).changePassword(current, next);
                runOnUiThread(() -> {
                    Toast.makeText(this, "Contraseña actualizada", Toast.LENGTH_LONG).show();
                    finish();
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    saveBtn.setEnabled(true);
                    errorText.setText(e.getMessage() != null ? e.getMessage() : "Error al cambiar contraseña");
                });
            }
        });
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN && event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            finish();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
