package tv.vix.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import android.util.Base64;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class NativeAuth {
    public static final String KEY_AUTH_TOKEN = "auth_token";

    public static class Result {
        public final boolean ok;
        public final String token;
        public final String error;
        public final boolean needsProfileSetup;
        public final boolean needsProfilePick;

        Result(boolean ok, String token, String error, boolean needsProfileSetup, boolean needsProfilePick) {
            this.ok = ok;
            this.token = token;
            this.error = error;
            this.needsProfileSetup = needsProfileSetup;
            this.needsProfilePick = needsProfilePick;
        }
    }

    private NativeAuth() {}

    public static boolean hasToken(Context context) {
        String t = prefs(context).getString(KEY_AUTH_TOKEN, "");
        return t != null && t.length() > 20;
    }

    public static void saveToken(Context context, String token) {
        prefs(context).edit().putString(KEY_AUTH_TOKEN, token == null ? "" : token.trim()).apply();
    }

    public static void clearToken(Context context) {
        prefs(context).edit().remove(KEY_AUTH_TOKEN).apply();
    }

    public static String getToken(Context context) {
        String t = prefs(context).getString(KEY_AUTH_TOKEN, "");
        return t == null ? "" : t;
    }

    /** true si el JWT no incluye profileId (cuenta multi-perfil sin elegir). */
    public static boolean needsProfileSelection(Context context) {
        String token = getToken(context);
        if (token.isEmpty()) return false;
        Integer pid = profileIdFromToken(token);
        return pid == null || pid <= 0;
    }

    public static Integer profileIdFromToken(String token) {
        try {
            String[] parts = token.split("\\.");
            if (parts.length < 2) return null;
            byte[] decoded = Base64.decode(parts[1], Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            JSONObject json = new JSONObject(new String(decoded, StandardCharsets.UTF_8));
            if (!json.has("profileId") || json.isNull("profileId")) return null;
            int id = json.optInt("profileId", 0);
            return id > 0 ? id : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    public static String usernameFromToken(String token) {
        try {
            String[] parts = token.split("\\.");
            if (parts.length < 2) return "";
            byte[] decoded = Base64.decode(parts[1], Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            JSONObject json = new JSONObject(new String(decoded, StandardCharsets.UTF_8));
            return json.optString("username", "");
        } catch (Exception ignored) {
            return "";
        }
    }

    public static String getUsername(Context context) {
        return usernameFromToken(getToken(context));
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE);
    }

    public static Result login(Context context, String username, String password) {
        String base = ServerUrlHelper.fromPrefs(prefs(context));
        HttpURLConnection conn = null;
        try {
            URL url = new URL(base + "/api/auth/login");
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("Accept", "application/json");
            JSONObject body = new JSONObject();
            body.put("username", username);
            body.put("password", password);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
            }
            int code = conn.getResponseCode();
            String response = readStream(conn, code >= 200 && code < 300);
            if (code >= 200 && code < 300) {
                JSONObject json = new JSONObject(response);
                String token = json.optString("token", "");
                if (token.isEmpty()) {
                    return new Result(false, "", "Respuesta sin token", false, false);
                }
                boolean needsSetup = json.optBoolean("needsProfileSetup", false);
                boolean needsPick = json.optBoolean("needsProfilePick", false);
                return new Result(true, token, "", needsSetup, needsPick);
            }
            String err = "Error de inicio de sesión";
            try {
                JSONObject json = new JSONObject(response);
                err = json.optString("error", err);
            } catch (Exception ignored) {
                if (code == 401) err = "Usuario o contraseña incorrectos";
            }
            return new Result(false, "", err, false, false);
        } catch (Exception e) {
            String msg = e.getMessage() == null ? "Sin conexión" : e.getMessage();
            return new Result(false, "", "No se pudo conectar con " + base + ": " + msg, false, false);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readStream(HttpURLConnection conn, boolean ok) throws Exception {
        BufferedReader reader = new BufferedReader(new InputStreamReader(
            ok ? conn.getInputStream() : conn.getErrorStream(),
            StandardCharsets.UTF_8
        ));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) sb.append(line);
        reader.close();
        return sb.toString();
    }
}
