package com.vixmusic.app;

public class MediaActionBridge {
    public interface Listener {
        void onMediaAction(String action);
        void onPlaybackEvent(String type, long positionMs, long durationMs);
    }

    private static Listener listener;

    public static void setListener(Listener l) {
        listener = l;
    }

    public static void dispatch(String action) {
        if (listener != null) {
            listener.onMediaAction(action);
        }
    }

    public static void dispatchPlayback(String type, long positionMs, long durationMs) {
        if (listener != null) {
            listener.onPlaybackEvent(type, positionMs, durationMs);
        }
    }
}
