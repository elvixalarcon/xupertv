package tv.vix.app;

import android.content.Context;
import android.graphics.Typeface;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.ui.PlayerView;

import java.util.Collections;

/** Utilidades UI estilo iOS (tema naranja, chips, reproductor inline). */
public final class MobileUi {
    private MobileUi() {}

    public static TextView createHomeChip(Context ctx, String label, boolean active, Runnable onClick) {
        TextView chip = new TextView(ctx);
        chip.setText(label);
        chip.setTextSize(14);
        chip.setTypeface(chip.getTypeface(), active ? Typeface.BOLD : Typeface.NORMAL);
        chip.setTextColor(ContextCompat.getColor(ctx, active ? R.color.mobile_accent : R.color.mobile_muted));
        chip.setBackgroundResource(active ? R.drawable.mobile_chip_active : R.drawable.mobile_chip_inactive);
        int h = dp(ctx, 8);
        int w = dp(ctx, 14);
        chip.setPadding(w, h, w, h);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMarginEnd(dp(ctx, 10));
        chip.setLayoutParams(lp);
        chip.setOnClickListener(v -> {
            if (onClick != null) onClick.run();
        });
        return chip;
    }

    public static TextView createCategoryChip(Context ctx, String label, boolean active, Runnable onClick) {
        TextView chip = new TextView(ctx);
        chip.setText(label);
        chip.setTextSize(13);
        chip.setTypeface(chip.getTypeface(), Typeface.BOLD);
        chip.setTextColor(ContextCompat.getColor(ctx, active ? android.R.color.black : R.color.mobile_text));
        chip.setBackgroundResource(active
            ? R.drawable.mobile_chip_category_active
            : R.drawable.mobile_chip_category_inactive);
        int h = dp(ctx, 8);
        int w = dp(ctx, 14);
        chip.setPadding(w, h, w, h);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMarginEnd(dp(ctx, 8));
        chip.setLayoutParams(lp);
        chip.setOnClickListener(v -> {
            if (onClick != null) onClick.run();
        });
        return chip;
    }

    public static void styleTabBackground(View tab, boolean selected) {
        if (tab == null) return;
        tab.setBackgroundResource(selected ? R.drawable.mobile_chip_category_active : android.R.color.transparent);
    }

    public static int dp(Context ctx, int value) {
        float d = ctx.getResources().getDisplayMetrics().density;
        return Math.round(value * d);
    }

    public static ExoPlayer playLive(Context ctx, PlayerView playerView, ExoPlayer existing, String url, String token) {
        ExoPlayer player = existing;
        if (player == null) {
            player = LivePlayerHelper.createPlayer(ctx);
            playerView.setPlayer(player);
        } else {
            player.stop();
            player.clearMediaItems();
        }
        LivePlayerHelper.start(player, url, "VixTV/1.0 mobile", token);
        return player;
    }

    public static void stopPlayer(ExoPlayer player) {
        if (player == null) return;
        player.setPlayWhenReady(false);
        player.stop();
        player.release();
    }
}
