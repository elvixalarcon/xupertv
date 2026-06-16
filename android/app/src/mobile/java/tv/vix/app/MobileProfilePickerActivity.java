package tv.vix.app;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
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

/** Selector de perfil estilo iOS (2 columnas, avatares cuadrados). */
public class MobileProfilePickerActivity extends AppCompatActivity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final List<JSONObject> profiles = new ArrayList<>();
    private ProgressBar loading;
    private TextView errorText;
    private ProfileAdapter adapter;
    private boolean selecting;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!NativeAuth.hasToken(this)) {
            startActivity(new Intent(this, VixAuthRoutes.loginActivityClass()));
            finish();
            return;
        }
        setContentView(R.layout.activity_mobile_profile_picker);
        loading = findViewById(R.id.mobile_picker_loading);
        errorText = findViewById(R.id.mobile_picker_error);
        RecyclerView list = findViewById(R.id.mobile_picker_list);
        int span = getResources().getDisplayMetrics().widthPixels > MobileUi.dp(this, 500) ? 4 : 2;
        list.setLayoutManager(new GridLayoutManager(this, span));
        adapter = new ProfileAdapter();
        list.setAdapter(adapter);
        loadProfiles();
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
                    this, new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 9004);
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

    private void loadProfiles() {
        loading.setVisibility(View.VISIBLE);
        errorText.setVisibility(View.GONE);
        executor.execute(() -> {
            try {
                JSONArray arr = new VixApi(this).listProfiles();
                if (arr.length() == 0) {
                    autoCreateProfileAndContinue();
                    return;
                }
                List<JSONObject> list = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) list.add(arr.getJSONObject(i));
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    profiles.clear();
                    profiles.addAll(list);
                    adapter.notifyDataSetChanged();
                    if (profiles.size() == 1) {
                        pickProfile(profiles.get(0));
                    }
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    errorText.setVisibility(View.VISIBLE);
                    errorText.setText(e.getMessage() != null ? e.getMessage() : "Error al cargar perfiles");
                });
            }
        });
    }

    private void autoCreateProfileAndContinue() {
        try {
            String name = NativeAuth.getUsername(this);
            if (name == null || name.isEmpty()) name = "Principal";
            JSONObject setup = new VixApi(this).setupProfile(name);
            String token = setup.optString("token", "");
            if (!token.isEmpty()) NativeAuth.saveToken(this, token);
            runOnUiThread(() -> openMainAndFinish());
        } catch (Exception e) {
            runOnUiThread(() -> {
                loading.setVisibility(View.GONE);
                errorText.setVisibility(View.VISIBLE);
                errorText.setText(e.getMessage() != null ? e.getMessage() : "No se pudo crear el perfil");
            });
        }
    }

    private void openMainAndFinish() {
        loading.setVisibility(View.GONE);
        Intent i = new Intent(this, VixAuthRoutes.mainActivityClass());
        i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
        finish();
    }

    private void pickProfile(JSONObject profile) {
        if (selecting) return;
        int id = profile.optInt("id", 0);
        if (id <= 0) return;
        Integer currentId = NativeAuth.profileIdFromToken(NativeAuth.getToken(this));
        if (currentId != null && currentId > 0 && currentId != id) {
            JSONObject current = findProfile(currentId);
            if (current != null && current.optInt("is_kids", 0) == 1
                && profile.optInt("is_kids", 0) == 0) {
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
        android.widget.EditText input = new android.widget.EditText(this);
        input.setHint("PIN infantil (4 dígitos)");
        input.setInputType(android.text.InputType.TYPE_CLASS_NUMBER
            | android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD);
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
        errorText.setVisibility(View.GONE);
        executor.execute(() -> {
            try {
                JSONObject res = new VixApi(this).selectProfile(profileId, pin);
                String token = res.optString("token", "");
                if (token.isEmpty()) throw new Exception("Sin token de perfil");
                NativeAuth.saveToken(this, token);
                runOnUiThread(() -> {
                    loading.setVisibility(View.GONE);
                    selecting = false;
                    Intent i = new Intent(this, VixAuthRoutes.mainActivityClass());
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
                        errorText.setVisibility(View.VISIBLE);
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
        public H onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = getLayoutInflater().inflate(R.layout.item_mobile_profile_avatar, parent, false);
            return new H(v);
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            int side = MobileUi.dp(MobileProfilePickerActivity.this, 120);
            ViewGroup.LayoutParams boxLp = holder.box.getLayoutParams();
            boxLp.width = ViewGroup.LayoutParams.MATCH_PARENT;
            boxLp.height = side;
            holder.box.setLayoutParams(boxLp);

            JSONObject p = profiles.get(position);
            String name = p.optString("name", "Perfil");
            holder.name.setText(name);
            boolean kids = p.optInt("is_kids", 0) == 1;
            holder.kids.setVisibility(kids ? View.VISIBLE : View.GONE);
            if (kids) holder.initial.setText("👶");
            else {
                holder.initial.setText(name.isEmpty() ? "?" : name.substring(0, 1).toUpperCase());
            }
            try {
                String color = p.optString("avatar_color", "#7C3AED");
                holder.initial.setBackgroundColor(Color.parseColor(color));
            } catch (Exception ignored) {
                holder.initial.setBackgroundColor(Color.parseColor("#7C3AED"));
            }
            holder.itemView.setOnClickListener(v -> pickProfile(p));
        }

        @Override
        public int getItemCount() {
            return profiles.size();
        }

        class H extends RecyclerView.ViewHolder {
            final View box;
            final TextView initial;
            final TextView name;
            final TextView kids;

            H(View itemView) {
                super(itemView);
                box = itemView.findViewById(R.id.mobile_avatar_box);
                initial = itemView.findViewById(R.id.mobile_avatar_initial);
                name = itemView.findViewById(R.id.mobile_avatar_name);
                kids = itemView.findViewById(R.id.mobile_avatar_kids);
            }
        }
    }

    @Override
    protected void onDestroy() {
        executor.shutdown();
        super.onDestroy();
    }
}
