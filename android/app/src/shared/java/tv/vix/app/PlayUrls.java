package tv.vix.app;

import java.net.URLEncoder;

public final class PlayUrls {
    private PlayUrls() {}

    public static String live(String server, String token, int channelId) {
        return live(server, token, channelId, null);
    }

    public static String live(String server, String token, int channelId, String sessionKey) {
        String q = server + "/api/live/ch/" + channelId + "/play.m3u8?token="
            + urlEncode(token) + "&profile=tv";
        if (sessionKey != null && !sessionKey.isEmpty()) {
            q += "&sid=" + urlEncode(sessionKey);
        }
        return q;
    }

    public static String video(String server, String token, String videoPath) {
        return videoWithActivity(server, token, videoPath, null, null, null, 0);
    }

    /** HLS vía proxy del servidor o manifest directo (.m3u8). */
    public static boolean isHlsPlaybackUrl(String url) {
        if (url == null || url.isEmpty()) return false;
        if (url.contains("/api/live/stream")) {
            return url.toLowerCase().contains(".m3u8");
        }
        return url.contains(".m3u8")
            || url.contains("/play.m3u8");
    }

    /** Stream OBS publicado en subdominio vixred o IP local (HLS en vivo). */
    public static boolean isVixredObsHls(String url) {
        if (url == null || url.isEmpty()) return false;
        return url.matches("(?i)https?://[^/]*vixred\\.com/hls/[^/?#]+\\.m3u8.*")
            || url.matches("(?i)https?://181\\.78\\.245\\.90/hls/[^/?#]+\\.m3u8.*")
            || url.matches("(?i)https?://5\\.5\\.5\\.4/hls/[^/?#]+\\.m3u8.*")
            || url.matches("(?i)^/hls/[^/?#]+\\.m3u8.*");
    }

    private static String obsHlsLocalPath(String url) {
        if (url == null) return "";
        java.util.regex.Matcher m = java.util.regex.Pattern
            .compile("(?i)/hls/([^/?#]+\\.m3u8)").matcher(url);
        return m.find() ? "/hls/" + m.group(1) : "";
    }

    public static boolean isObsLiveUrl(String url) {
        if (url == null || url.isEmpty()) return false;
        return url.contains("/api/live/stream") && url.contains("vixred.com%2Fhls")
            || url.contains("/api/live/stream") && url.contains("vixred.com/hls")
            || url.contains("/api/live/stream") && url.contains("181.78.245.90%2Fhls")
            || url.contains("/api/live/stream") && url.contains("181.78.245.90/hls")
            || url.contains("/api/live/stream") && url.contains("chillanestv.m3u8")
            || isVixredObsHls(url);
    }

    public static boolean isDirectLiveChannel(boolean directSource, String streamUrl) {
        return directSource || isVixredObsHls(streamUrl);
    }

    /** URL de reproducción: OBS local → directo; radio → proxy de audio; resto → play.m3u8 */
    public static String livePlayback(String server, String token, int channelId,
                                      String streamUrl, boolean directSource, String sessionKey) {
        return livePlayback(server, token, channelId, streamUrl, directSource, false, "", sessionKey);
    }

    public static String livePlayback(String server, String token, int channelId,
                                      String streamUrl, boolean directSource) {
        return livePlayback(server, token, channelId, streamUrl, directSource, null);
    }

    public static String livePlayback(String server, String token, int channelId,
                                      String streamUrl, boolean directSource, boolean radio,
                                      String playbackReferer, String sessionKey) {
        if (radio && streamUrl != null && !streamUrl.isEmpty()
            && (streamUrl.startsWith("http://") || streamUrl.startsWith("https://"))) {
            String q = server + "/api/live/stream?url=" + urlEncode(streamUrl) + "&token=" + urlEncode(token);
            if (playbackReferer != null && !playbackReferer.isEmpty()) {
                q += "&referer=" + urlEncode(playbackReferer);
            }
            return appendActivityQuery(q, token, sessionKey, "En vivo", "live", channelId);
        }
        if (streamUrl != null && streamUrl.startsWith("/cache/live/")) {
            String base = server + streamUrl;
            return appendActivityQuery(base, token, sessionKey, "En vivo", "live", channelId);
        }
        if (isVixredObsHls(streamUrl)) {
            if (channelId > 0 && token != null && !token.isEmpty()) {
                return live(server, token, channelId);
            }
            String local = obsHlsLocalPath(streamUrl);
            if (!local.isEmpty() && server != null && !server.isEmpty()) {
                String base = server.endsWith("/") ? server.substring(0, server.length() - 1) : server;
                return base + local;
            }
            if (streamUrl.startsWith("/hls/") && server != null && !server.isEmpty()) {
                String base = server.endsWith("/") ? server.substring(0, server.length() - 1) : server;
                return base + streamUrl;
            }
            if (streamUrl.startsWith("http://") || streamUrl.startsWith("https://")) {
                return streamUrl;
            }
        }
        if (isDirectLiveChannel(directSource, streamUrl)
            && streamUrl != null && !streamUrl.isEmpty()
            && streamUrl.startsWith("/hls/")
            && server != null && !server.isEmpty()) {
            String base = server.endsWith("/") ? server.substring(0, server.length() - 1) : server;
            return base + streamUrl;
        }
        if (isDirectLiveChannel(directSource, streamUrl)
            && streamUrl != null && !streamUrl.isEmpty()
            && (streamUrl.startsWith("http://") || streamUrl.startsWith("https://"))) {
            return streamUrl;
        }
        return live(server, token, channelId, sessionKey);
    }

    public static String livePlayback(String server, String token, int channelId,
                                      String streamUrl, boolean directSource, boolean radio,
                                      String playbackReferer) {
        return livePlayback(server, token, channelId, streamUrl, directSource, radio, playbackReferer, null);
    }

    private static boolean isServerStreamUrl(String videoPath, String server) {
        if (videoPath == null || videoPath.isEmpty()) return false;
        if (videoPath.contains("/api/live/stream")) return true;
        return server != null && !server.isEmpty()
            && videoPath.startsWith(server)
            && videoPath.contains("/api/live/stream");
    }

    public static String videoWithActivity(String server, String token, String videoPath,
                                           String sessionKey, String watchTitle,
                                           String watchType, int watchId) {
        if (videoPath == null || videoPath.isEmpty()) return "";
        String base;
        if (isServerStreamUrl(videoPath, server)) {
            base = videoPath.startsWith("/") ? server + videoPath : videoPath;
        } else if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) {
            base = server + "/api/live/stream?url=" + urlEncode(videoPath) + "&token=" + urlEncode(token);
        } else {
            String path = videoPath;
            if (path.startsWith("/uploads/movies/")) {
                base = server + "/api/stream/movies/" + path.substring("/uploads/movies/".length());
            } else if (path.startsWith("/uploads/series/")) {
                base = server + "/api/stream/series/" + path.substring("/uploads/series/".length());
            } else if (path.startsWith("/uploads/winscp/")) {
                base = server + "/api/stream/winscp/" + path.substring("/uploads/winscp/".length());
            } else if (path.startsWith("/")) {
                base = server + path;
            } else {
                base = server + "/" + path;
            }
        }
        return appendActivityQuery(base, token, sessionKey, watchTitle, watchType, watchId);
    }

    private static String appendActivityQuery(String base, String token, String sessionKey,
                                              String watchTitle, String watchType, int watchId) {
        if (base == null || base.isEmpty()) return "";
        StringBuilder q = new StringBuilder(base);
        String sep = base.contains("?") ? "&" : "?";
        if (token != null && !token.isEmpty() && !base.contains("token=")) {
            q.append(sep).append("token=").append(urlEncode(token));
            sep = "&";
        }
        if (sessionKey != null && !sessionKey.isEmpty()) {
            q.append(sep).append("sid=").append(urlEncode(sessionKey));
            sep = "&";
        }
        if (watchTitle != null && !watchTitle.isEmpty()) {
            q.append(sep).append("watch_title=").append(urlEncode(watchTitle));
            sep = "&";
        }
        if (watchType != null && !watchType.isEmpty()) {
            q.append(sep).append("watch_type=").append(urlEncode(watchType));
            sep = "&";
        }
        if (watchId > 0) {
            q.append(sep).append("watch_id=").append(watchId);
        }
        return q.toString();
    }

    public static String poster(String server, String poster) {
        if (poster == null || poster.isEmpty()) return "";
        if (poster.startsWith("http://") || poster.startsWith("https://")) return poster;
        if (poster.startsWith("/")) return server + poster;
        return server + "/" + poster;
    }

    public static boolean isPlaceholderPoster(String path) {
        if (path == null || path.isEmpty()) return true;
        return path.contains("/api/posters/cover");
    }

    /** URL de portada para tarjetas: TMDB real o JPEG de respaldo (Glide no decodifica SVG). */
    public static String posterForItem(String server, String title, int year, String poster) {
        if (!isPlaceholderPoster(poster)) return poster(server, poster);
        if (title != null && !title.isEmpty()) {
            return coverJpeg(server, title, year > 0 ? String.valueOf(year) : "");
        }
        return "";
    }

    public static String coverJpeg(String server, String title, String year) {
        String q = server + "/api/posters/cover.jpg?title=" + urlEncode(title);
        if (year != null && !year.isEmpty()) q += "&year=" + urlEncode(year);
        return q;
    }

    private static String urlEncode(String value) {
        try {
            return URLEncoder.encode(value == null ? "" : value, "UTF-8");
        } catch (Exception e) {
            return value;
        }
    }
}
