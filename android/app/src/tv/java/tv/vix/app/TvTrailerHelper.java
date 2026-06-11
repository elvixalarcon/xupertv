package tv.vix.app;

import android.annotation.SuppressLint;
import android.webkit.WebSettings;
import android.webkit.WebView;

public final class TvTrailerHelper {
    private TvTrailerHelper() {}

    public static String extractYoutubeKey(String trailer) {
        if (trailer == null) return "";
        String t = trailer.trim();
        if (t.isEmpty()) return "";
        if (t.matches("^[a-zA-Z0-9_-]{11}$")) return t;
        if (t.contains("youtu.be/")) {
            int i = t.indexOf("youtu.be/") + 9;
            return t.substring(i).split("[?&]")[0];
        }
        if (t.contains("v=")) {
            int i = t.indexOf("v=") + 2;
            return t.substring(i).split("[&]")[0];
        }
        if (t.contains("/embed/")) {
            int i = t.indexOf("/embed/") + 7;
            return t.substring(i).split("[?&]")[0];
        }
        return "";
    }

    public static String embedUrl(String trailer) {
        String key = extractYoutubeKey(trailer);
        if (key.isEmpty()) return "";
        return "https://www.youtube.com/embed/" + key
            + "?autoplay=1&mute=0&controls=0&rel=0&playsinline=1&modestbranding=1&loop=1";
    }

    @SuppressLint("SetJavaScriptEnabled")
    public static void playInWebView(WebView webView, String trailer) {
        if (!VixTvApplication.isWebViewAvailable()) return;
        String url = embedUrl(trailer);
        if (url.isEmpty() || webView == null) return;
        try {
            WebSettings s = webView.getSettings();
            s.setJavaScriptEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            webView.setVisibility(android.view.View.VISIBLE);
            webView.loadUrl(url);
        } catch (Throwable ignored) {
            webView.setVisibility(android.view.View.GONE);
        }
    }

    public static void stopWebView(WebView webView) {
        if (webView == null) return;
        webView.loadUrl("about:blank");
        webView.setVisibility(android.view.View.GONE);
    }
}
