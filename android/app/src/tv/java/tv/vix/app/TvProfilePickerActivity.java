package tv.vix.app;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Selector de perfil (Netflix) — historial y seguir viendo van por perfil. */
public class TvProfilePickerActivity extends AppCompatActivity {
    public static final String EXTRA_FROM_SWITCH = "from_switch";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final List<JSONObject> profiles = new ArrayList<>();
    private TextView errorText;
    private ProgressBar loading;
    private ProfileAdapter adapter;
    private boolean selecting;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!NativeAuth.hasToken(this)) {
            startActivity(new Intent(this, TvLoginActivity.class));
            finish();
            return;
        }
        setContentView(R.layout.activity_tv_profile_picker);
        errorText = findViewById(R.id.tv_profile_error);
        loading = findViewById(R.id.tv_profile_loading);
        RecyclerView list = findViewById(R.id.tv_profile_list);
        list.setLayoutManager(new GridLayoutManager(this, 4));
        adapter = new ProfileAdapter();
        list.setAdapter(adapter);
        loadProfiles();
    }

    private void loadProfiles() {
        loading.setVisibility(View.VISIBLE);
        errorText.setText("");
        executor.execute(() -> {
            try {
                JSONArray arr = new VixApi(this).listProfiles();
                List<JSONObject> list = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) list.add(arr.getJSONObject(i));
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    profiles.clear();
                    profiles.addAll(list);
                    adapter.notifyDataSetChanged();
                    if (profiles.isEmpty()) {
                        errorText.setText("No hay perfiles. Crea uno en la web.");
                    }
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    errorText.setText(e.getMessage() != null ? e.getMessage() : "Error al cargar perfiles");
                });
            }
        });
    }

    private void pickProfile(JSONObject profile) {
        if (selecting) return;
        int id = profile.optInt("id", 0);
        if (id <= 0) return;

        Integer currentId = NativeAuth.profileIdFromToken(NativeAuth.getToken(this));
        if (currentId != null && currentId > 0 && currentId != id) {
            JSONObject current = findProfile(currentId);
            if (current != null && current.optInt("is_kids", 0) == 1 && profile.optInt("is_kids", 0) == 0) {
                promptPinThenSelect(id);
                return;
            }
        }
        doSelect(id, "");
    }

    private JSONObject findProfile(int id) {
        for (JSONObject p : profiles) {
            if (p.optInt("id", 0) == id) return p;
        }
        return null;
    }

    private void promptPinThenSelect(int profileId) {
        EditText input = new EditText(this);
        input.setHint("PIN infantil (4 dígitos)");
        input.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        new AlertDialog.Builder(this)
            .setTitle("PIN requerido")
            .setMessage("Introduce el PIN del perfil infantil para salir.")
            .setView(input)
            .setPositiveButton("Continuar", (d, w) -> doSelect(profileId, input.getText().toString().trim()))
            .setNegativeButton("Cancelar", null)
            .show();
    }

    private void doSelect(int profileId, String pin) {
        if (selecting) return;
        selecting = true;
        loading.setVisibility(View.VISIBLE);
        errorText.setText("");
        executor.execute(() -> {
            try {
                JSONObject res = new VixApi(this).selectProfile(profileId, pin);
                String token = res.optString("token", "");
                if (token.isEmpty()) throw new Exception("Sin token de perfil");
                NativeAuth.saveToken(this, token);
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    selecting = false;
                    Intent i = new Intent(this, TvShellActivity.class);
                    i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                    finish();
                });
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "No se pudo elegir perfil";
                boolean needsPin = msg.toLowerCase().contains("pin");
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    selecting = false;
                    if (needsPin) promptPinThenSelect(profileId);
                    else {
                        errorText.setText(msg);
                        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
                    }
                });
            }
        });
    }

    private class ProfileAdapter extends RecyclerView.Adapter<ProfileAdapter.H> {
        @NonNull
        @Override
        public H onCreateViewHolder(@NonNull android.view.ViewGroup parent, int viewType) {
            return new H(getLayoutInflater().inflate(R.layout.item_tv_profile, parent, false));
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            JSONObject p = profiles.get(position);
            String name = p.optString("name", "Perfil");
            holder.name.setText(name);
            holder.avatar.setText(name.isEmpty() ? "?" : name.substring(0, 1).toUpperCase());
            try {
                String color = p.optString("avatar_color", "#e50914");
                holder.avatar.setBackgroundColor(Color.parseColor(color));
            } catch (Exception ignored) {
                holder.avatar.setBackgroundColor(Color.parseColor("#e50914"));
            }
            boolean kids = p.optInt("is_kids", 0) == 1;
            holder.kids.setVisibility(kids ? View.VISIBLE : View.GONE);
            holder.itemView.setOnClickListener(v -> pickProfile(p));
            holder.itemView.setOnKeyListener((v, keyCode, event) -> {
                if (event.getAction() == KeyEvent.ACTION_DOWN && isEnterKey(keyCode)) {
                    pickProfile(p);
                    return true;
                }
                return false;
            });
        }

        @Override
        public int getItemCount() { return profiles.size(); }

        class H extends RecyclerView.ViewHolder {
            final TextView avatar;
            final TextView name;
            final TextView kids;

            H(View itemView) {
                super(itemView);
                avatar = itemView.findViewById(R.id.tv_profile_avatar);
                name = itemView.findViewById(R.id.tv_profile_name);
                kids = itemView.findViewById(R.id.tv_profile_kids);
            }
        }
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
