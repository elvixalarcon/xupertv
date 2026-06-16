package tv.vix.app;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;

import androidx.core.view.ViewCompat;

/** Animaciones de foco estilo Xuper TV (portadas, canales, filas). */
final class TvFocusAnim {
    private static final DecelerateInterpolator EASE = new DecelerateInterpolator(1.4f);
    private static final OvershootInterpolator POP = new OvershootInterpolator(0.9f);

    private TvFocusAnim() {}

    static void applyPoster(View v, boolean focused) {
        if (v == null) return;
        v.animate().cancel();
        float scale = focused ? 1.14f : 1f;
        float ty = focused ? -12f : 0f;
        long dur = focused ? 220 : 160;
        v.animate()
            .scaleX(scale)
            .scaleY(scale)
            .translationY(ty)
            .setDuration(dur)
            .setInterpolator(focused ? POP : EASE)
            .start();
        ViewCompat.setElevation(v, focused ? 16f : 0f);
        v.setTranslationZ(focused ? 10f : 0f);
    }

    static void applyChannel(View v, boolean focused) {
        if (v == null) return;
        v.animate().cancel();
        float scale = focused ? 1.12f : 1f;
        v.animate()
            .scaleX(scale)
            .scaleY(scale)
            .translationX(focused ? -10f : 0f)
            .setDuration(focused ? 220 : 150)
            .setInterpolator(focused ? POP : EASE)
            .start();
        ViewCompat.setElevation(v, focused ? 14f : 0f);
        v.setTranslationZ(focused ? 8f : 0f);
    }

    /** Agranda el reproductor en vivo al enfocar un canal. */
    static void applyLivePlayer(View wrap, View ring, boolean active) {
        if (wrap == null) return;
        wrap.animate().cancel();
        float scale = active ? 1.06f : 1f;
        wrap.animate()
            .scaleX(scale)
            .scaleY(scale)
            .setDuration(active ? 260 : 180)
            .setInterpolator(active ? POP : EASE)
            .start();
        ViewCompat.setElevation(wrap, active ? 12f : 0f);
        if (ring != null) {
            ring.setVisibility(active ? View.VISIBLE : View.GONE);
            ring.setAlpha(active ? 0f : 0f);
            if (active) {
                ring.animate().alpha(1f).setDuration(200).start();
            }
        }
    }

    static void pulseLivePlayer(View wrap) {
        if (wrap == null) return;
        wrap.animate().cancel();
        wrap.animate()
            .scaleX(1.1f)
            .scaleY(1.1f)
            .setDuration(180)
            .setInterpolator(POP)
            .withEndAction(() -> wrap.animate()
                .scaleX(1.06f)
                .scaleY(1.06f)
                .setDuration(200)
                .setInterpolator(EASE)
                .start())
            .start();
    }

    static void applyEpisodeRow(View v, boolean focused) {
        if (v == null) return;
        v.animate().cancel();
        float scale = focused ? 1.03f : 1f;
        v.animate()
            .scaleX(scale)
            .scaleY(scale)
            .setDuration(focused ? 200 : 140)
            .setInterpolator(EASE)
            .start();
        ViewCompat.setElevation(v, focused ? 8f : 0f);
    }

    static void applySeasonChip(View v, boolean focused) {
        if (v == null) return;
        applyPoster(v, focused);
    }

    static void pulsePlayIcon(View playIcon, boolean show) {
        if (playIcon == null) return;
        playIcon.animate().cancel();
        if (!show) {
            playIcon.setVisibility(View.INVISIBLE);
            playIcon.setAlpha(0f);
            playIcon.setScaleX(0.6f);
            playIcon.setScaleY(0.6f);
            return;
        }
        playIcon.setVisibility(View.VISIBLE);
        playIcon.setAlpha(0f);
        playIcon.setScaleX(0.5f);
        playIcon.setScaleY(0.5f);
        playIcon.animate()
            .alpha(1f)
            .scaleX(1.15f)
            .scaleY(1.15f)
            .setDuration(240)
            .setInterpolator(POP)
            .start();
    }

    static void crossfade(View target, Runnable onMid) {
        if (target == null) {
            if (onMid != null) onMid.run();
            return;
        }
        target.animate().cancel();
        target.animate()
            .alpha(0.12f)
            .setDuration(130)
            .setListener(new AnimatorListenerAdapter() {
                @Override
                public void onAnimationEnd(Animator animation) {
                    if (onMid != null) onMid.run();
                    target.animate()
                        .alpha(1f)
                        .setDuration(280)
                        .setInterpolator(EASE)
                        .setListener(null)
                        .start();
                }
            })
            .start();
    }
}
