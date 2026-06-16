package tv.vix.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import tv.vix.app.CatalogModels.CatalogRow;
import tv.vix.app.CatalogModels.HeroData;

/**
 * Caché en memoria del catálogo móvil. Se precarga al abrir la app (nueva sesión)
 * y se reutiliza al cambiar pestañas sin recargar la red.
 */
public final class MobileContentCache {
    public static final class CatalogSnapshot {
        public final HeroData hero;
        public final List<CatalogRow> rows;

        CatalogSnapshot(HeroData hero, List<CatalogRow> rows) {
            this.hero = hero;
            this.rows = rows != null ? rows : new ArrayList<>();
        }
    }

    public static final class ProfileSnapshot {
        public final String username;
        public final List<JSONObject> favorites;
        public final List<JSONObject> history;
        public final List<JSONObject> continueItems;

        ProfileSnapshot(String username, List<JSONObject> favorites,
                        List<JSONObject> history, List<JSONObject> continueItems) {
            this.username = username != null ? username : "Perfil";
            this.favorites = favorites != null ? favorites : new ArrayList<>();
            this.history = history != null ? history : new ArrayList<>();
            this.continueItems = continueItems != null ? continueItems : new ArrayList<>();
        }
    }

    public static final class LiveSnapshot {
        public final List<JSONObject> categories;
        public final List<JSONObject> channels;

        LiveSnapshot(List<JSONObject> categories, List<JSONObject> channels) {
            this.categories = categories != null ? categories : new ArrayList<>();
            this.channels = channels != null ? channels : new ArrayList<>();
        }
    }

    private static final String[] WARM_SLUGS = {
        "home", "destacados", "movies", "series", "kids", "anime", "explorar", "categories"
    };

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean SESSION_STARTED = new AtomicBoolean(false);
    private static final AtomicBoolean WARMING = new AtomicBoolean(false);

    private static final Map<String, CatalogSnapshot> CATALOG = new ConcurrentHashMap<>();
    private static final Map<String, LiveSnapshot> LIVE_BY_GROUP = new ConcurrentHashMap<>();
    private static volatile List<JSONObject> LIVE_CATEGORIES = new ArrayList<>();
    private static volatile ProfileSnapshot PROFILE;
    private static final Map<Integer, JSONObject> MOVIE_DETAILS = new ConcurrentHashMap<>();
    private static final Map<Integer, JSONObject> SERIES_DETAILS = new ConcurrentHashMap<>();
    private static final Map<String, JSONObject> EXTERNAL_MOVIES = new ConcurrentHashMap<>();
    private static final Map<String, JSONObject> EXTERNAL_SERIES = new ConcurrentHashMap<>();

    private MobileContentCache() {}

    /** Llamar una vez al abrir {@link MobileMainActivity}; precarga catálogo en segundo plano. */
    public static void beginSession(Context ctx) {
        if (!SESSION_STARTED.compareAndSet(false, true)) return;
        warmAll(ctx.getApplicationContext());
    }

    public static void warmAll(Context ctx) {
        if (!WARMING.compareAndSet(false, true)) return;
        Context app = ctx.getApplicationContext();
        EXECUTOR.execute(() -> {
            try {
                for (String slug : WARM_SLUGS) {
                    fetchCatalog(app, slug);
                }
                fetchLive(app, "all");
                fetchProfile(app);
            } finally {
                WARMING.set(false);
            }
        });
    }

    public static CatalogSnapshot getCatalog(String slug) {
        return CATALOG.get(slug != null ? slug : "home");
    }

    public static void putCatalog(String slug, HeroData hero, List<CatalogRow> rows) {
        if (slug == null) return;
        CATALOG.put(slug, new CatalogSnapshot(hero, rows));
    }

    public static LiveSnapshot getLive(String group) {
        String key = group == null || group.isEmpty() ? "all" : group;
        return LIVE_BY_GROUP.get(key);
    }

    public static List<JSONObject> getLiveCategories() {
        return LIVE_CATEGORIES;
    }

    public static void putLive(String group, List<JSONObject> categories, List<JSONObject> channels) {
        String key = group == null || group.isEmpty() ? "all" : group;
        if (categories != null && !categories.isEmpty()) LIVE_CATEGORIES = categories;
        LIVE_BY_GROUP.put(key, new LiveSnapshot(LIVE_CATEGORIES, channels));
    }

    public static ProfileSnapshot getProfile() {
        return PROFILE;
    }

    public static void putProfile(ProfileSnapshot snapshot) {
        PROFILE = snapshot;
    }

    public static JSONObject getMovieDetail(int id) {
        return id > 0 ? MOVIE_DETAILS.get(id) : null;
    }

    public static void putMovieDetail(int id, JSONObject detail) {
        if (id > 0 && detail != null) MOVIE_DETAILS.put(id, detail);
    }

    public static JSONObject getSeriesDetail(int id) {
        return id > 0 ? SERIES_DETAILS.get(id) : null;
    }

    public static void putSeriesDetail(int id, JSONObject detail) {
        if (id > 0 && detail != null) SERIES_DETAILS.put(id, detail);
    }

    public static JSONObject getExternalMovie(String source, String slug) {
        return EXTERNAL_MOVIES.get(externalKey(source, slug));
    }

    public static void putExternalMovie(String source, String slug, JSONObject detail) {
        EXTERNAL_MOVIES.put(externalKey(source, slug), detail);
    }

    public static JSONObject getExternalSeries(String source, String slug) {
        return EXTERNAL_SERIES.get(externalKey(source, slug));
    }

    public static void putExternalSeries(String source, String slug, JSONObject detail) {
        EXTERNAL_SERIES.put(externalKey(source, slug), detail);
    }

    /** Invalida solo listas de usuario (p. ej. tras reproducir). No recarga catálogo completo. */
    public static void invalidateProfile(Context ctx) {
        PROFILE = null;
        EXECUTOR.execute(() -> fetchProfile(ctx.getApplicationContext()));
    }

    public static void invalidateMovieDetail(int id) {
        if (id > 0) MOVIE_DETAILS.remove(id);
    }

    public static void invalidateSeriesDetail(int id) {
        if (id > 0) SERIES_DETAILS.remove(id);
    }

    private static String externalKey(String source, String slug) {
        return (source != null ? source : "") + "|" + (slug != null ? slug : "");
    }

    private static void fetchCatalog(Context app, String slug) {
        final String key = slug;
        CatalogLoader.Callback cb = new CatalogLoader.Callback() {
            @Override
            public void onLoaded(HeroData hero, List<CatalogRow> rows) {
                putCatalog(key, hero, rows);
            }

            @Override
            public void onError(Exception error) { /* conservar caché anterior */ }
        };
        if ("home".equals(slug)) CatalogLoader.loadHome(app, cb);
        else if ("categories".equals(slug)) CatalogLoader.loadCategories(app, cb);
        else CatalogLoader.loadStorefront(app, slug, cb);
        // CatalogLoader es async con su propio executor; esperamos vía callback
    }

    private static void fetchLive(Context app) {
        fetchLive(app, "all");
    }

    private static void fetchLive(Context app, String group) {
        try {
            VixApi api = new VixApi(app);
            List<JSONObject> cats = new ArrayList<>();
            try {
                JSONArray arr = api.liveCategories();
                for (int i = 0; i < arr.length(); i++) cats.add(arr.getJSONObject(i));
            } catch (Exception ignored) { }
            String g = "all".equals(group) ? null : group;
            JSONArray chArr = api.liveChannels(g);
            List<JSONObject> ch = new ArrayList<>();
            for (int i = 0; i < chArr.length(); i++) ch.add(chArr.getJSONObject(i));
            putLive(group, cats, ch);
        } catch (Exception ignored) { }
    }

    private static void fetchProfile(Context app) {
        try {
            VixApi api = new VixApi(app);
            JSONObject me = api.me();
            JSONArray fav = api.favorites();
            JSONArray hist = api.watchHistory();
            JSONArray cont = api.watchContinue();
            List<JSONObject> f = jsonList(fav);
            List<JSONObject> h = jsonList(hist);
            List<JSONObject> c = jsonList(cont);
            putProfile(new ProfileSnapshot(me.optString("username", "Perfil"), f, h, c));
            // Actualizar fila "Continuar viendo" del inicio si ya estaba cargada
            CatalogSnapshot home = getCatalog("home");
            if (home != null && !c.isEmpty()) {
                refreshHomeContinueRow(c);
            }
        } catch (Exception ignored) { }
    }

    private static void refreshHomeContinueRow(List<JSONObject> continueItems) {
        CatalogSnapshot home = getCatalog("home");
        if (home == null) return;
        List<CatalogRow> rows = new ArrayList<>();
        boolean replaced = false;
        for (CatalogRow row : home.rows) {
            if (row.continueRow) {
                List<CatalogModels.CatalogItem> items = new ArrayList<>();
                int max = Math.min(StorefrontParser.ROW_PREVIEW_MAX, continueItems.size());
                for (int i = 0; i < max; i++) {
                    items.add(StorefrontParser.itemFromContinue(continueItems.get(i)));
                }
                rows.add(new CatalogRow("Continuar viendo", items, false,
                    null, null, "mixed", continueItems.size(), true));
                replaced = true;
            } else {
                rows.add(row);
            }
        }
        if (replaced) putCatalog("home", home.hero, rows);
    }

    private static List<JSONObject> jsonList(JSONArray arr) throws org.json.JSONException {
        List<JSONObject> list = new ArrayList<>();
        if (arr == null) return list;
        for (int i = 0; i < arr.length(); i++) list.add(arr.getJSONObject(i));
        return list;
    }

    /** Precarga un slug si aún no está en caché (p. ej. chip de inicio). */
    public static void ensureCatalog(Context ctx, String slug) {
        if (getCatalog(slug) != null) return;
        EXECUTOR.execute(() -> fetchCatalog(ctx.getApplicationContext(), slug));
    }

    /** Precarga canales de un grupo si falta. */
    public static void ensureLive(Context ctx, String group) {
        String key = group == null || group.isEmpty() ? "all" : group;
        if (getLive(key) != null) return;
        EXECUTOR.execute(() -> fetchLive(ctx.getApplicationContext(), key));
    }
}
