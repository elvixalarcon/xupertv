package tv.vix.app;

import java.net.URLEncoder;

public final class PlayUrls {
    private PlayUrls() {}

    public static String live(String server, String token, int channelId) {
        return server + "/api/live/ch/" + channelId + "/play.m3u8?token="
            + urlEncode(token) + "&profile=tv";
    }

    public static String video(String server, String token, String videoPath) {
        if (videoPath == null || videoPath.isEmpty()) return "";
        if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) {
            return server + "/api/live/stream?url=" + urlEncode(videoPath) + "&token=" + urlEncode(token);
        }
        String path = videoPath;
        if (path.startsWith("/uploads/movies/")) {
            return server + "/api/stream/movies/" + path.substring("/uploads/movies/".length());
        }
        if (path.startsWith("/uploads/series/")) {
            return server + "/api/stream/series/" + path.substring("/uploads/series/".length());
        }
        if (path.startsWith("/uploads/winscp/")) {
            return server + "/api/stream/winscp/" + path.substring("/uploads/winscp/".length());
        }
        if (path.startsWith("/")) {
            return server + path;
        }
        return server + "/" + path;
    }

    public static String poster(String server, String poster) {
        if (poster == null || poster.isEmpty()) return "";
        if (poster.startsWith("http://") || poster.startsWith("https://")) return poster;
        if (poster.startsWith("/")) return server + poster;
        return server + "/" + poster;
    }

    private static String urlEncode(String value) {
        try {
            return URLEncoder.encode(value == null ? "" : value, "UTF-8");
        } catch (Exception e) {
            return value;
        }
    }
}
