package tv.vix.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import tv.vix.app.CatalogModels.CatalogItem;
import tv.vix.app.CatalogModels.CatalogRow;
import tv.vix.app.CatalogModels.HeroData;

public final class StorefrontParser {
    public static final int ROW_PREVIEW_MAX = 10;

    private StorefrontParser() {}

    public static List<CatalogRow> parseSections(JSONObject page) {
        List<CatalogRow> rows = new ArrayList<>();
        JSONArray sections = page.optJSONArray("sections");
        if (sections == null) return rows;
        try {
            for (int i = 0; i < sections.length(); i++) {
                JSONObject sec = sections.optJSONObject(i);
                if (sec == null) continue;
                JSONArray items = sec.optJSONArray("items");
                if (items == null || items.length() == 0) continue;
                int total = sec.optInt("total", items.length());
                int max = Math.min(ROW_PREVIEW_MAX, items.length());
                String rowType = sec.optString("type", "movie");
                if ("mixed".equals(rowType)) {
                    rowType = TvCatalogHelper.resolveContentType(items.getJSONObject(0), "movie");
                }
                List<CatalogItem> list = new ArrayList<>();
                for (int j = 0; j < max; j++) {
                    list.add(itemFromStorefront(items.getJSONObject(j), rowType));
                }
                rows.add(new CatalogRow(
                    sec.optString("title", ""),
                    list,
                    false,
                    sec.optString("id", ""),
                    sec.optString("genre", ""),
                    rowType,
                    total
                ));
            }
        } catch (org.json.JSONException ignored) { /* fila inválida */ }
        return rows;
    }

    public static HeroData buildHero(VixApi api, JSONObject page) throws Exception {
        List<CatalogItem> allHero = new ArrayList<>();
        String slug = page.optString("slug", "");
        if ("series".equals(slug)) {
            JSONArray seriesHero = api.seriesHero();
            for (int i = 0; i < seriesHero.length(); i++) {
                allHero.add(itemFromSeries(seriesHero.getJSONObject(i)));
            }
        } else {
            JSONArray hero = page.optJSONArray("hero");
            if (hero != null) {
                for (int i = 0; i < hero.length(); i++) {
                    allHero.add(itemFromStorefront(hero.getJSONObject(i), defaultTypeForSlug(slug)));
                }
            }
        }
        CatalogItem fixed = allHero.isEmpty() ? null : allHero.get(0);
        List<CatalogItem> rotating = new ArrayList<>();
        for (int i = 1; i < allHero.size(); i++) rotating.add(allHero.get(i));
        if (rotating.isEmpty() && fixed != null) rotating.add(fixed);
        CatalogItem[] tiles = new CatalogItem[4];
        JSONArray recent = page.optJSONArray("recent");
        if (recent != null) {
            for (int i = 0; i < Math.min(4, recent.length()); i++) {
                tiles[i] = itemFromStorefront(recent.getJSONObject(i), defaultTypeForSlug(slug));
            }
        }
        for (int i = 0; i < 4; i++) {
            if (tiles[i] != null) continue;
            int src = i + 1;
            if (src < allHero.size()) tiles[i] = allHero.get(src);
        }
        return new HeroData(rotating, fixed, tiles);
    }

    public static CatalogItem itemFromStorefront(JSONObject o, String defaultType) {
        if (TvCatalogHelper.isExternalItem(o)) return itemFromExternal(o);
        if ("series".equals(TvCatalogHelper.resolveContentType(o, defaultType))) return itemFromSeries(o);
        return itemFromMovie(o);
    }

    public static CatalogItem itemFromMovie(JSONObject m) {
        return new CatalogItem(
            m.optInt("id", 0),
            m.optString("title", ""),
            m.optString("poster", ""),
            m.optString("backdrop", ""),
            m.optString("banner", ""),
            m.optString("trailer", ""),
            m.optString("video_path", ""),
            false,
            "movie",
            0,
            0,
            0,
            null,
            TvPosterBind.ratingFromJson(m)
        );
    }

    public static CatalogItem itemFromSeries(JSONObject s) {
        return new CatalogItem(
            s.optInt("id", 0),
            s.optString("title", ""),
            s.optString("poster", ""),
            s.optString("backdrop", s.optString("poster", "")),
            s.optString("banner", ""),
            s.optString("trailer", ""),
            null,
            true,
            "series",
            0,
            0,
            0,
            null,
            TvPosterBind.ratingFromJson(s)
        );
    }

    public static CatalogItem itemFromContinue(JSONObject c) {
        String type = c.optString("content_type", "movie");
        boolean isEp = "episode".equals(type);
        String title = c.optString("title", "");
        if (isEp) title = c.optString("series_title", "") + " · " + title;
        long prog = (long) c.optDouble("progress", 0);
        long dur = (long) c.optDouble("duration", 0);
        int pct = dur > 0 ? (int) Math.min(100, (prog * 100) / dur) : 0;
        return new CatalogItem(
            c.optInt("content_id", 0),
            title,
            c.optString("poster", ""),
            "",
            "",
            "",
            c.optString("video_path", ""),
            isEp,
            type,
            c.optInt("series_id", 0),
            prog,
            dur,
            pct > 0 ? pct + "% visto" : null,
            TvPosterBind.ratingFromJson(c)
        );
    }

    private static CatalogItem itemFromExternal(JSONObject o) {
        String type = o.optString("content_type", "movie");
        boolean isSeries = "series".equals(type);
        return new CatalogItem(
            0,
            o.optString("title", ""),
            o.optString("poster", ""),
            o.optString("backdrop", o.optString("poster", "")),
            o.optString("banner", ""),
            "",
            null,
            isSeries,
            type,
            0,
            0,
            0,
            null,
            TvPosterBind.ratingFromJson(o),
            true,
            o.optString("source", ""),
            o.optString("slug", ""),
            o.optInt("year", 0)
        );
    }

    private static String defaultTypeForSlug(String slug) {
        if ("series".equals(slug)) return "series";
        return "movie";
    }
}
