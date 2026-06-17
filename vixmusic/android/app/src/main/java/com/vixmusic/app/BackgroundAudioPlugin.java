package com.vixmusic.app;

import android.content.Intent;
import android.Manifest;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

@CapacitorPlugin(
    name = "BackgroundAudio",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class BackgroundAudioPlugin extends Plugin {

    @Override
    public void load() {
        super.load();
        MediaActionBridge.setListener(new MediaActionBridge.Listener() {
            @Override
            public void onMediaAction(String action) {
                JSObject data = new JSObject();
                data.put("action", action);
                notifyListeners("mediaAction", data);
            }

            @Override
            public void onPlaybackEvent(String type, long positionMs, long durationMs) {
                JSObject data = new JSObject();
                data.put("type", type);
                data.put("position", positionMs / 1000.0);
                data.put("duration", durationMs / 1000.0);
                notifyListeners("playbackEvent", data);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        MediaActionBridge.setListener(null);
        super.handleOnDestroy();
    }

    private void sendServiceIntent(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
    }

    @PluginMethod
    public void play(PluginCall call) {
        String playUrl = call.getString("playUrl", "");
        if (playUrl.isEmpty()) {
            call.reject("playUrl requerido");
            return;
        }
        Intent intent = new Intent(getContext(), MediaPlaybackService.class);
        intent.putExtra(MediaPlaybackService.EXTRA_PLAY_URL, playUrl);
        intent.putExtra(MediaPlaybackService.EXTRA_TITLE, call.getString("title", "VixMusic"));
        intent.putExtra(MediaPlaybackService.EXTRA_ARTIST, call.getString("artist", ""));
        intent.putExtra(MediaPlaybackService.EXTRA_IMAGE_URL, call.getString("imageUrl", ""));
        intent.putExtra(MediaPlaybackService.EXTRA_VOLUME, call.getDouble("volume", 1.0).floatValue());
        sendServiceIntent(intent);
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        Intent intent = new Intent(getContext(), MediaPlaybackService.class);
        intent.putExtra(MediaPlaybackService.EXTRA_TITLE, call.getString("title", "VixMusic"));
        intent.putExtra(MediaPlaybackService.EXTRA_ARTIST, call.getString("artist", ""));
        intent.putExtra(MediaPlaybackService.EXTRA_IMAGE_URL, call.getString("imageUrl", ""));
        intent.putExtra(MediaPlaybackService.EXTRA_PLAYING, call.getBoolean("playing", true));
        sendServiceIntent(intent);
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        Intent intent = new Intent(getContext(), MediaPlaybackService.class);
        intent.putExtra(MediaPlaybackService.EXTRA_TITLE, call.getString("title", "VixMusic"));
        intent.putExtra(MediaPlaybackService.EXTRA_ARTIST, call.getString("artist", ""));
        intent.putExtra(MediaPlaybackService.EXTRA_IMAGE_URL, call.getString("imageUrl", ""));
        intent.putExtra(MediaPlaybackService.EXTRA_PLAYING, call.getBoolean("playing", true));
        sendServiceIntent(intent);
        call.resolve();
    }

    @PluginMethod
    public void setPlaying(PluginCall call) {
        boolean playing = call.getBoolean("playing", true);
        Intent intent = new Intent(getContext(), MediaPlaybackService.class);
        intent.putExtra(
            MediaPlaybackService.EXTRA_ACTION,
            playing ? MediaPlaybackService.ACTION_RESUME : MediaPlaybackService.ACTION_PAUSE
        );
        sendServiceIntent(intent);
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Intent intent = new Intent(getContext(), MediaPlaybackService.class);
        intent.putExtra(MediaPlaybackService.EXTRA_VOLUME, call.getDouble("volume", 1.0).floatValue());
        sendServiceIntent(intent);
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        double seconds = call.getDouble("position", 0.0);
        MediaPlaybackService service = MediaPlaybackService.getInstance();
        if (service != null && service.getExoPlayer() != null) {
            service.getExoPlayer().seekTo((long) (seconds * 1000L));
        }
        call.resolve();
    }

    @PluginMethod
    public void getPlaybackStatus(PluginCall call) {
        MediaPlaybackService service = MediaPlaybackService.getInstance();
        JSObject ret = new JSObject();
        if (service == null || service.getExoPlayer() == null) {
            ret.put("playing", false);
            ret.put("position", 0);
            ret.put("duration", 0);
            call.resolve(ret);
            return;
        }
        androidx.media3.exoplayer.ExoPlayer player = service.getExoPlayer();
        ret.put("playing", player.isPlaying());
        ret.put("position", player.getCurrentPosition() / 1000.0);
        ret.put("duration", player.getDuration() / 1000.0);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), MediaPlaybackService.class);
        intent.putExtra(MediaPlaybackService.EXTRA_ACTION, MediaPlaybackService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String fileName = call.getString("fileName", "VixMusic-update.apk");
        java.io.File apk = new java.io.File(getContext().getCacheDir(), fileName);
        if (!apk.exists() || apk.length() < 1024) {
            call.reject("Archivo de actualización no encontrado");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!getContext().getPackageManager().canRequestPackageInstalls()) {
                try {
                    Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    settings.setData(Uri.parse("package:" + getContext().getPackageName()));
                    settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(settings);
                } catch (Exception e) {
                    call.reject("Permite instalar apps desconocidas para VixMusic", e);
                    return;
                }
                call.reject("Activa «Instalar apps desconocidas» y pulsa Actualizar de nuevo");
                return;
            }
        }

        try {
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo abrir el instalador", e);
        }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL vacía");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo abrir el enlace", e);
        }
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (getPermissionState("notifications") == com.getcapacitor.PermissionState.GRANTED) {
                call.resolve();
                return;
            }
            requestPermissionForAlias("notifications", call, "notificationsPerms");
            return;
        }
        call.resolve();
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void notificationsPerms(PluginCall call) {
        call.resolve();
    }
}
