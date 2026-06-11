package tv.vix.app;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

public class SettingsActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        SharedPreferences prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE);
        ServerUrlHelper.ensureDefault(prefs);
        EditText input = findViewById(R.id.server_input);
        input.setText(ServerUrlHelper.fromPrefs(prefs));

        Button save = findViewById(R.id.btn_save);
        save.setOnClickListener(v -> {
            String url = ServerUrlHelper.normalize(input.getText().toString());
            prefs.edit().putString(MainActivity.KEY_SERVER, url).apply();
            Toast.makeText(this, R.string.server_saved, Toast.LENGTH_SHORT).show();
            finish();
        });

        Button reset = findViewById(R.id.btn_reset_server);
        reset.setOnClickListener(v -> {
            input.setText(ServerUrlHelper.OFFICIAL_SERVER);
            prefs.edit().putString(MainActivity.KEY_SERVER, ServerUrlHelper.OFFICIAL_SERVER).apply();
            Toast.makeText(this, R.string.server_reset_default, Toast.LENGTH_SHORT).show();
        });
    }
}
