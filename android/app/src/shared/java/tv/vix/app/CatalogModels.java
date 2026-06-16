package tv.vix.app;

import java.util.List;

public final class CatalogModels {
    private CatalogModels() {}

    public static class CatalogItem {
        public final int id;
        public final String title;
        public final String poster;
        public final String videoPath;
        public final boolean isSeries;
        public final String contentType;
        public final int seriesId;
        public final long progress;
        public final long duration;
        public final String subtitle;
        public final String backdrop;
        public final String banner;
        public final String trailer;
        public final double rating;
        public final boolean external;
        public final String source;
        public final String slug;
        public final int year;

        public CatalogItem(int id, String title, String poster, String backdrop, String banner, String trailer,
                           String videoPath, boolean isSeries, String contentType, int seriesId,
                           long progress, long duration, String subtitle, double rating) {
            this(id, title, poster, backdrop, banner, trailer, videoPath, isSeries, contentType,
                seriesId, progress, duration, subtitle, rating, false, "", "", 0);
        }

        public CatalogItem(int id, String title, String poster, String backdrop, String banner, String trailer,
                           String videoPath, boolean isSeries, String contentType, int seriesId,
                           long progress, long duration, String subtitle, double rating,
                           boolean external, String source, String slug, int year) {
            this.id = id;
            this.title = title;
            this.poster = poster;
            this.backdrop = backdrop;
            this.banner = banner;
            this.trailer = trailer;
            this.videoPath = videoPath;
            this.isSeries = isSeries;
            this.contentType = contentType;
            this.seriesId = seriesId;
            this.progress = progress;
            this.duration = duration;
            this.subtitle = subtitle;
            this.rating = rating;
            this.external = external;
            this.source = source != null ? source : "";
            this.slug = slug != null ? slug : "";
            this.year = year;
        }
    }

    public static class CatalogRow {
        public final String label;
        public final List<CatalogItem> items;
        public final boolean hero;
        public final String sectionId;
        public final String genre;
        public final String rowType;
        public final int totalCount;
        public final boolean continueRow;

        public CatalogRow(String label, List<CatalogItem> items, boolean hero) {
            this(label, items, hero, null, null, "movie", items != null ? items.size() : 0, false);
        }

        public CatalogRow(String label, List<CatalogItem> items, boolean hero,
                          String sectionId, String genre, String rowType, int totalCount) {
            this(label, items, hero, sectionId, genre, rowType, totalCount, false);
        }

        public CatalogRow(String label, List<CatalogItem> items, boolean hero,
                          String sectionId, String genre, String rowType, int totalCount, boolean continueRow) {
            this.label = label;
            this.items = items;
            this.hero = hero;
            this.sectionId = sectionId;
            this.genre = genre;
            this.rowType = rowType;
            this.totalCount = totalCount > 0 ? totalCount : (items != null ? items.size() : 0);
            this.continueRow = continueRow;
        }
    }

    public static class HeroData {
        public final List<CatalogItem> rotating;
        public final CatalogItem fixed;
        public final CatalogItem[] tiles;

        public HeroData(List<CatalogItem> rotating, CatalogItem fixed, CatalogItem[] tiles) {
            this.rotating = rotating;
            this.fixed = fixed;
            this.tiles = tiles;
        }
    }
}
