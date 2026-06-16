package tv.vix.app;

import android.view.View;
import android.widget.ImageButton;
import android.widget.ImageView;

import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

/** Tráiler inline en el hero (como iOS) con silencio activable. */
public final class MobileHeroTrailerPlayer {
    private final Fragment fragment;
    private final PlayerView playerView;
    private final ImageButton muteButton;
    private final ImageView backdropView;

    private ExoPlayer player;
    private boolean muted = true;
    private boolean playing;
    private String currentTrailer = "";

    public MobileHeroTrailerPlayer(Fragment fragment, PlayerView playerView,
                                   ImageButton muteButton, ImageView backdropView) {
        this.fragment = fragment;
        this.playerView = playerView;
        this.muteButton = muteButton;
        this.backdropView = backdropView;
        playerView.setVisibility(View.GONE);
        playerView.setUseController(false);
        muteButton.setVisibility(View.GONE);
        muteButton.setOnClickListener(v -> toggleMute());
        updateMuteIcon();
    }

    public void playTrailer(@Nullable String trailer) {
        stop();
        if (trailer == null || trailer.trim().isEmpty()) return;
        if (!fragment.isAdded()) return;
        currentTrailer = trailer;
        MobileTrailerHelper.prefetch(fragment.requireContext(), trailer);
        MobileTrailerHelper.resolveInfo(fragment.requireContext(), trailer, info -> {
            if (!fragment.isAdded() || !trailer.equals(currentTrailer)) return;
            if (info == null || info.playUrl == null || info.playUrl.isEmpty()) return;
            MobileTrailerHelper.warmStreamCache(fragment.requireContext(), info);
            player = MobileTrailerHelper.playInView(
                (androidx.appcompat.app.AppCompatActivity) fragment.requireActivity(),
                playerView, muteButton, backdropView, player, info, muted);
            playing = true;
        });
    }

    public void stop() {
        playing = false;
        currentTrailer = "";
        MobileTrailerHelper.stop(player, playerView, muteButton, backdropView);
        player = null;
    }

    public void pause() {
        if (player != null) player.pause();
    }

    public void resume() {
        if (player != null && playing) player.play();
    }

    private void toggleMute() {
        muted = !muted;
        if (player != null) player.setVolume(muted ? 0f : 1f);
        updateMuteIcon();
    }

    private void updateMuteIcon() {
        muteButton.setImageResource(muted ? R.drawable.ic_mobile_volume_off : R.drawable.ic_mobile_volume_on);
        muteButton.setContentDescription(muted ? "Activar audio del tráiler" : "Silenciar tráiler");
    }

    public void destroy() {
        stop();
    }
}
