package tv.vix.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import tv.vix.app.CatalogModels.CatalogItem;
import tv.vix.app.CatalogModels.CatalogRow;
import tv.vix.app.CatalogModels.HeroData;

/** Carga catálogo (inicio, storefront, categorías) compartida entre TV y móvil. */
public final class CatalogLoader {
    public interface Callback {
        void onLoaded(HeroData hero, List<CatalogRow> rows);
        void onError(Exception error);
    }

    private static final ExecutorService EXECUTOR = Executors.newCachedThreadPool();

    private CatalogLoader() {}

    public static void loadHome(Context ctx, Callback cb) {
        EXECUTOR.execute(() -> {
            try {
                VixApi api = new VixApi(ctx);
                List<CatalogItem> allHero = new ArrayList<>();
                JSONArray hero = api.moviesHero();
                for (int i = 0; i < hero.length(); i++) {
                    allHero.add(StorefrontParser.itemFromMovie(hero.getJSONObject(i)));
                }
                CatalogItem fixed = allHero.isEmpty() ? null : allHero.get(0);
                List<CatalogItem> rotating = new ArrayList<>();
                for (int i = 1; i < allHero.size(); i++) rotating.add(allHero.get(i));
                if (rotating.isEmpty() && fixed != null) rotating.add(fixed);
                CatalogItem[] tiles = new CatalogItem[4];
                try {
                    JSONArray recent = api.moviesRecent();
                    for (int i = 0; i < Math.min(4, recent.length()); i++) {
                        tiles[i] = StorefrontParser.itemFromMovie(recent.getJSONObject(i));
                    }
                } catch (Exception ignored) { /* sin recientes */ }
                for (int i = 0; i < 4 && tiles[i] == null; i++) {
                    int src = i + 1;
                    if (src < allHero.size()) tiles[i] = allHero.get(src);
                }
                List<CatalogRow> rows = new ArrayList<>();
                try {
                    JSONArray cont = api.watchContinue();
                    if (cont.length() > 0) {
                        List<CatalogItem> contItems = new ArrayList<>();
                        int contTotal = cont.length();
                        int contMax = Math.min(StorefrontParser.ROW_PREVIEW_MAX, contTotal);
                        for (int i = 0; i < contMax; i++) {
                            contItems.add(StorefrontParser.itemFromContinue(cont.getJSONObject(i)));
                        }
                        rows.add(new CatalogRow("Continuar viendo", contItems, false,
                            null, null, "mixed", contTotal, true));
                    }
                } catch (Exception ignored) { /* sin perfil */ }
                JSONObject home = api.catalogHome();
                JSONArray sections = home.optJSONArray("sections");
                if (sections != null) {
                    for (int i = 0; i < sections.length(); i++) {
                        JSONObject sec = sections.getJSONObject(i);
                        JSONArray items = sec.optJSONArray("items");
                        if (items == null || items.length() == 0) continue;
                        int total = sec.optInt("total", items.length());
                        int max = Math.min(StorefrontParser.ROW_PREVIEW_MAX, items.length());
                        List<CatalogItem> list = new ArrayList<>();
                        for (int j = 0; j < max; j++) {
                            JSONObject it = items.getJSONObject(j);
                            String type = it.optString("content_type", sec.optString("type", "movie"));
                            if ("series".equals(type)) list.add(StorefrontParser.itemFromSeries(it));
                            else list.add(StorefrontParser.itemFromMovie(it));
                        }
                        rows.add(new CatalogRow(
                            sec.optString("title", ""),
                            list,
                            false,
                            sec.optString("id", ""),
                            sec.optString("genre", ""),
                            sec.optString("type", "movie"),
                            total
                        ));
                    }
                }
                cb.onLoaded(new HeroData(rotating, fixed, tiles), rows);
            } catch (Exception e) {
                cb.onError(e);
            }
        });
    }

    public static void loadStorefront(Context ctx, String slug, Callback cb) {
        EXECUTOR.execute(() -> {
            try {
                VixApi api = new VixApi(ctx);
                try {
                    JSONObject page = api.catalogStorefront(slug);
                    HeroData hero = StorefrontParser.buildHero(api, page);
                    List<CatalogRow> rows = StorefrontParser.parseSections(page);
                    if (!rows.isEmpty() || hero.fixed != null || !hero.rotating.isEmpty()) {
                        cb.onLoaded(hero, rows);
                        return;
                    }
                } catch (Exception ignored) {
                    /* API storefront no disponible */
                }
                loadStorefrontLegacy(ctx, api, slug, cb);
            } catch (Exception e) {
                cb.onError(e);
            }
        });
    }

    public static void loadCategories(Context ctx, Callback cb) {
        EXECUTOR.execute(() -> {
            try {
                VixApi api = new VixApi(ctx);
                HeroData hero = fetchMoviesHero(api);
                JSONObject page = api.catalogCategories();
                List<CatalogRow> rows = StorefrontParser.parseSections(page);
                cb.onLoaded(hero, rows);
            } catch (Exception e) {
                cb.onError(e);
            }
        });
    }

    private static void loadStorefrontLegacy(Context ctx, VixApi api, String slug, Callback cb) throws Exception {
        HeroData hero;
        List<CatalogRow> rows = new ArrayList<>();
        if ("series".equals(slug)) {
            hero = buildSeriesHero(api);
            appendGenreRows(rows, api.seriesGenreRows(), "series", "series");
        } else if ("movies".equals(slug)) {
            hero = fetchMoviesHero(api);
            appendGenreRows(rows, api.moviesGenreRows(), "movies", "movie");
        } else if ("destacados".equals(slug)) {
            hero = fetchMoviesHero(api);
            appendGenreRows(rows, api.moviesGenreRows(), "movies", "movie");
            appendGenreRows(rows, api.seriesGenreRows(), "series", "series");
        } else {
            hero = fetchMoviesHero(api);
            appendGenreRows(rows, api.moviesGenreRows(), "movies", "movie");
            if ("explorar".equals(slug)) {
                appendGenreRows(rows, api.seriesGenreRows(), "series", "series");
            }
        }
        cb.onLoaded(hero, rows);
    }

    private static HeroData buildSeriesHero(VixApi api) throws Exception {
        List<CatalogItem> allHero = new ArrayList<>();
        JSONArray seriesHero = api.seriesHero();
        for (int i = 0; i < seriesHero.length(); i++) {
            allHero.add(StorefrontParser.itemFromSeries(seriesHero.getJSONObject(i)));
        }
        CatalogItem fixed = allHero.isEmpty() ? null : allHero.get(0);
        List<CatalogItem> rotating = new ArrayList<>();
        for (int i = 1; i < allHero.size(); i++) rotating.add(allHero.get(i));
        if (rotating.isEmpty() && fixed != null) rotating.add(fixed);
        CatalogItem[] tiles = new CatalogItem[4];
        for (int i = 0; i < 4 && i < allHero.size(); i++) {
            tiles[i] = allHero.get(Math.min(i + 1, allHero.size() - 1));
        }
        return new HeroData(rotating, fixed, tiles);
    }

    private static HeroData fetchMoviesHero(VixApi api) throws Exception {
        List<CatalogItem> allHero = new ArrayList<>();
        JSONArray hero = api.moviesHero();
        for (int i = 0; i < hero.length(); i++) {
            allHero.add(StorefrontParser.itemFromMovie(hero.getJSONObject(i)));
        }
        CatalogItem fixed = allHero.isEmpty() ? null : allHero.get(0);
        List<CatalogItem> rotating = new ArrayList<>();
        for (int i = 1; i < allHero.size(); i++) rotating.add(allHero.get(i));
        if (rotating.isEmpty() && fixed != null) rotating.add(fixed);
        return new HeroData(rotating, fixed, new CatalogItem[4]);
    }

    private static void appendGenreRows(List<CatalogRow> rows, JSONArray genreRows,
                                        String arrayKey, String rowType) throws Exception {
        for (int i = 0; i < genreRows.length(); i++) {
            JSONObject row = genreRows.getJSONObject(i);
            JSONArray items = row.optJSONArray(arrayKey);
            if (items == null) items = row.optJSONArray("items");
            if (items == null || items.length() == 0) continue;
            int total = row.optInt("count", items.length());
            int max = Math.min(StorefrontParser.ROW_PREVIEW_MAX, items.length());
            List<CatalogItem> list = new ArrayList<>();
            for (int j = 0; j < max; j++) {
                JSONObject o = items.getJSONObject(j);
                list.add("series".equals(rowType)
                    ? StorefrontParser.itemFromSeries(o)
                    : StorefrontParser.itemFromMovie(o));
            }
            rows.add(new CatalogRow(
                row.optString("genre", row.optString("title", "")),
                list,
                false,
                null,
                row.optString("genre", ""),
                rowType,
                total
            ));
        }
    }
}
