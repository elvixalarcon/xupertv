package tv.vix.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public final class VixApi {
    public static class ApiException extends Exception {
        public final int code;

        ApiException(String message, int code) {
            super(message);
            this.code = code;
        }
    }

    private final Context context;

    public VixApi(Context context) {
        this.context = context.getApplicationContext();
    }

    public String baseUrl() {
        return ServerUrlHelper.fromPrefs(
            context.getSharedPreferences(AppConstants.PREFS, Context.MODE_PRIVATE)
        );
    }

    public String token() {
        return NativeAuth.getToken(context);
    }

    public NativeAuth.Result login(String user, String pass) {
        return NativeAuth.login(context, user, pass);
    }

    public JSONObject setupProfile(String name) throws Exception {
        JSONObject body = new JSONObject();
        body.put("name", name);
        return postJson("/api/profiles/setup", body);
    }

    public JSONArray listProfiles() throws Exception {
        return getJsonArray("/api/profiles");
    }

    public JSONObject selectProfile(int profileId, String pin) throws Exception {
        JSONObject body = new JSONObject();
        body.put("profileId", profileId);
        if (pin != null && !pin.isEmpty()) body.put("pin", pin);
        return postJson("/api/profiles/select", body);
    }

    public JSONObject me() throws Exception {
        return getJson("/api/auth/me");
    }

    public void changePassword(String currentPassword, String newPassword) throws Exception {
        JSONObject body = new JSONObject();
        body.put("current_password", currentPassword);
        body.put("new_password", newPassword);
        postJson("/api/auth/change-password", body);
    }

    public JSONArray liveChannels(String group) throws Exception {
        String path = "/api/live/channels";
        if (group != null && !group.isEmpty()) {
            path += "?group=" + URLEncoder.encode(group, "UTF-8");
        }
        return getJsonArray(path);
    }

    public JSONArray liveCategories() throws Exception {
        return getJsonArray("/api/live/categories");
    }

    public JSONArray movies() throws Exception {
        return getJsonArray("/api/movies");
    }

    public JSONArray series() throws Exception {
        return getJsonArray("/api/series");
    }

    public JSONObject seriesDetail(int id) throws Exception {
        return getJson("/api/series/" + id + "/detail");
    }

    public JSONArray moviesHero() throws Exception {
        return getJsonArray("/api/movies/hero");
    }

    public JSONArray moviesRecent() throws Exception {
        return getJsonArray("/api/movies/recent");
    }

    public JSONArray moviesGenreRows() throws Exception {
        return getJsonArray("/api/movies/genre-rows?limit=10");
    }

    public JSONArray moviesByGenre(String genre) throws Exception {
        String enc = URLEncoder.encode(genre, "UTF-8");
        return getJsonArray("/api/movies/by-genre?genre=" + enc + "&limit=500");
    }

    public JSONArray seriesByGenre(String genre) throws Exception {
        String enc = URLEncoder.encode(genre, "UTF-8");
        return getJsonArray("/api/series/by-genre?genre=" + enc + "&limit=500");
    }

    public JSONArray catalogSection(String sectionId) throws Exception {
        String enc = URLEncoder.encode(sectionId, "UTF-8");
        return getJsonArray("/api/catalog/section/" + enc + "?limit=500");
    }

    public JSONArray seriesGenreRows() throws Exception {
        return getJsonArray("/api/series/genre-rows?limit=10");
    }

    public JSONObject catalogHome() throws Exception {
        return getJson("/api/catalog/home");
    }

    public JSONObject worldCupBanner() throws Exception {
        return getJson("/api/worldcup/banner");
    }

    public JSONObject catalogCategories() throws Exception {
        return getJson("/api/catalog/categories");
    }

    public JSONObject catalogStorefront(String slug) throws Exception {
        String enc = URLEncoder.encode(slug, "UTF-8");
        return getJson("/api/catalog/storefront/" + enc);
    }

    public JSONArray seriesHero() throws Exception {
        return getJsonArray("/api/series/hero");
    }

    public JSONObject globalSearch(String query) throws Exception {
        String enc = URLEncoder.encode(query, "UTF-8");
        return getJson("/api/search?q=" + enc + "&limit=30");
    }

    public JSONObject liveEpg() throws Exception {
        return getJson("/api/live/epg");
    }

    public JSONArray watchContinue() throws Exception {
        return getJsonArray("/api/watch/continue");
    }

    public JSONArray watchHistory() throws Exception {
        return getJsonArray("/api/watch/history");
    }

    public JSONArray watchlist() throws Exception {
        return getJsonArray("/api/library/watchlist");
    }

    public JSONArray favorites() throws Exception {
        return getJsonArray("/api/library/likes");
    }

    public JSONObject movieDetail(int id) throws Exception {
        return getJson("/api/movies/" + id + "/detail");
    }

    /** URL reproducible del tráiler (proxy YouTube vía servidor). */
    public String trailerPlayUrl(String youtubeKeyOrUrl) throws Exception {
        return trailerInfo(youtubeKeyOrUrl).playUrl;
    }

    /** Metadatos del tráiler (URL + mime para HLS/MP4). */
    public TrailerInfo trailerInfo(String youtubeKeyOrUrl) throws Exception {
        String key = TvTrailerHelper.extractYoutubeKey(youtubeKeyOrUrl);
        if (key.isEmpty()) throw new ApiException("Tráiler no disponible", 400);
        JSONObject res = getJson("/api/trailers/youtube/" + URLEncoder.encode(key, "UTF-8"));
        String playUrl = res.optString("playUrl", "");
        if (playUrl.isEmpty()) throw new ApiException("Tráiler no disponible", 404);
        if (!playUrl.startsWith("http")) {
            String base = baseUrl();
            if (base.endsWith("/") && playUrl.startsWith("/")) playUrl = base + playUrl.substring(1);
            else playUrl = base + playUrl;
        }
        return new TrailerInfo(key, playUrl, res.optString("mime", ""));
    }

    public static final class TrailerInfo {
        public final String videoId;
        public final String playUrl;
        public final String mime;

        public TrailerInfo(String videoId, String playUrl, String mime) {
            this.videoId = videoId;
            this.playUrl = playUrl;
            this.mime = mime != null ? mime : "";
        }

        public boolean isHls() {
            if (mime.contains("mpegurl") || mime.contains("m3u8")) return true;
            String u = playUrl.toLowerCase(java.util.Locale.US);
            return u.contains(".m3u8") || u.contains("/stream/");
        }
    }

    public JSONObject externalMovieMeta(String source, String slug, Integer year) throws Exception {
        String encSource = URLEncoder.encode(source, "UTF-8");
        String encSlug = URLEncoder.encode(slug, "UTF-8");
        String path = "/api/catalog/external/" + encSource + "/" + encSlug;
        if (year != null && year > 0) {
            path += "?year=" + year;
        }
        return getJson(path);
    }

    public JSONObject externalMoviePlay(String source, String slug, Integer year, String quality) throws Exception {
        String encSource = URLEncoder.encode(source, "UTF-8");
        String encSlug = URLEncoder.encode(slug, "UTF-8");
        String q = quality != null && !quality.isEmpty() ? quality : "1080";
        String path = "/api/catalog/external/" + encSource + "/" + encSlug + "/play?quality="
            + URLEncoder.encode(q, "UTF-8");
        if (year != null && year > 0) {
            path += "&year=" + year;
        }
        return getJson(path);
    }

    public JSONObject externalSeriesMeta(String source, String slug) throws Exception {
        String encSource = URLEncoder.encode(source, "UTF-8");
        String encSlug = URLEncoder.encode(slug, "UTF-8");
        return getJson("/api/catalog/external/" + encSource + "/series/" + encSlug);
    }

    public JSONObject externalSeriesPlay(String source, String slug, int season, int episode,
                                         String quality) throws Exception {
        String encSource = URLEncoder.encode(source, "UTF-8");
        String encSlug = URLEncoder.encode(slug, "UTF-8");
        String q = quality != null && !quality.isEmpty() ? quality : "1080";
        String path = "/api/catalog/external/" + encSource + "/series/" + encSlug + "/play?season="
            + season + "&episode=" + episode + "&quality=" + URLEncoder.encode(q, "UTF-8");
        return getJson(path);
    }

    public JSONObject watchProgress(String contentType, int contentId) throws Exception {
        return getJson("/api/watch/progress/" + contentType + "/" + contentId);
    }

    public JSONObject watchSeriesProgress(int seriesId) throws Exception {
        return getJson("/api/watch/series/" + seriesId + "/progress");
    }

    public void saveWatchProgress(String contentType, int contentId, int seriesId,
                                  long progressSec, long durationSec) throws Exception {
        JSONObject body = new JSONObject();
        body.put("content_type", contentType);
        body.put("content_id", contentId);
        body.put("progress", progressSec);
        body.put("duration", durationSec);
        if (seriesId > 0) body.put("series_id", seriesId);
        putJson("/api/watch/progress", body);
    }

    /** Heartbeat de conexión activa (admin → Conexiones en vivo). */
    public void sendActivityHeartbeat(String status, String page, String title,
                                      String contentType, int contentId,
                                      long progressSec, long durationSec) {
        sendActivityHeartbeat(status, page, title, contentType, contentId, progressSec, durationSec,
            ActivitySession.shellKey(context));
    }

    public void sendActivityHeartbeat(String status, String page, String title,
                                      String contentType, int contentId,
                                      long progressSec, long durationSec, String sessionKey) {
        try {
            JSONObject body = new JSONObject();
            body.put("status", status != null ? status : "browsing");
            body.put("page", page != null ? page : "");
            body.put("title", title != null ? title : "");
            body.put("content_type", contentType != null ? contentType : "");
            if (contentId > 0) body.put("content_id", contentId);
            body.put("progress", progressSec);
            body.put("duration", durationSec);
            body.put("session_key", sessionKey != null && !sessionKey.isEmpty()
                ? sessionKey : ActivitySession.shellKey(context));
            postJsonSilent("/api/activity/heartbeat", body);
        } catch (Exception ignored) { /* no bloquear reproducción */ }
    }

    public void sendActivityOffline() {
        sendActivityOffline(ActivitySession.shellKey(context));
    }

    public void sendActivityOffline(String sessionKey) {
        try {
            JSONObject body = new JSONObject();
            body.put("session_key", sessionKey != null && !sessionKey.isEmpty()
                ? sessionKey : ActivitySession.shellKey(context));
            postJsonSilent("/api/activity/offline", body);
        } catch (Exception ignored) { /* ignore */ }
    }

    private void postJsonSilent(String path, JSONObject body) throws Exception {
        request("POST", path, body.toString());
    }

    private JSONObject putJson(String path, JSONObject body) throws Exception {
        String raw = request("PUT", path, body.toString());
        return new JSONObject(raw);
    }

    private JSONObject getJson(String path) throws Exception {
        String raw = request("GET", path, null);
        String trimmed = raw != null ? raw.trim() : "";
        if (trimmed.startsWith("<")) {
            throw new ApiException("El servidor no devolvió datos JSON. Reinicia el servidor o actualiza la app.", 502);
        }
        return new JSONObject(raw);
    }

    private JSONArray getJsonArray(String path) throws Exception {
        String raw = request("GET", path, null);
        String trimmed = raw != null ? raw.trim() : "";
        if (trimmed.startsWith("<")) {
            throw new ApiException("El servidor no devolvió datos. Actualiza la app o contacta soporte.", 502);
        }
        return new JSONArray(raw);
    }

    private JSONObject postJson(String path, JSONObject body) throws Exception {
        String raw = request("POST", path, body.toString());
        return new JSONObject(raw);
    }

    private String request(String method, String path, String jsonBody) throws Exception {
        String t = token();
        if (t == null || t.length() < 10) {
            throw new ApiException("Sin sesión", 401);
        }
        HttpURLConnection conn = null;
        try {
            URL url = new URL(baseUrl() + path);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(30000);
            conn.setRequestMethod(method);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + t);
            if (jsonBody != null) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] bytes = jsonBody.getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(bytes);
                }
            }
            int code = conn.getResponseCode();
            String response = readBody(conn, code >= 200 && code < 300);
            if (code >= 200 && code < 300) return response;
            String err = "Error del servidor";
            try {
                err = new JSONObject(response).optString("error", err);
            } catch (Exception ignored) {
                if (code == 401) err = "Sesión expirada";
            }
            throw new ApiException(err, code);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readBody(HttpURLConnection conn, boolean ok) throws Exception {
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
