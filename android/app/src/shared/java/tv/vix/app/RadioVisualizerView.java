package tv.vix.app;

import android.animation.ValueAnimator;
import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import android.view.animation.LinearInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.Nullable;

import com.bumptech.glide.Glide;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class RadioVisualizerView extends FrameLayout {
    private static final String GROUP_RADIO_ECUADOR = "Radio Ecuador";

    private ImageView logoView;
    private TextView titleView;
    private final List<View> eqBars = new ArrayList<>();
    private final List<ValueAnimator> animators = new ArrayList<>();

    public RadioVisualizerView(Context context) {
        super(context);
        init();
    }

    public RadioVisualizerView(Context context, @Nullable AttributeSet attrs) {
        super(context, attrs);
        init();
    }

    private void init() {
        inflate(getContext(), R.layout.view_radio_visualizer, this);
        logoView = findViewById(R.id.radio_viz_logo);
        titleView = findViewById(R.id.radio_viz_title);
        eqBars.add(findViewById(R.id.radio_eq_1));
        eqBars.add(findViewById(R.id.radio_eq_2));
        eqBars.add(findViewById(R.id.radio_eq_3));
        eqBars.add(findViewById(R.id.radio_eq_4));
        eqBars.add(findViewById(R.id.radio_eq_5));
        eqBars.add(findViewById(R.id.radio_eq_6));
        eqBars.add(findViewById(R.id.radio_eq_7));
        setVisibility(GONE);
    }

    public static boolean isRadioChannel(@Nullable JSONObject ch) {
        if (ch == null) return false;
        if (ch.optBoolean("radio", false)) return true;
        String group = ch.optString("group_title", ch.optString("group", "")).trim();
        return GROUP_RADIO_ECUADOR.equals(group);
    }

    public static boolean isRadioGroup(@Nullable String group) {
        return GROUP_RADIO_ECUADOR.equals(group != null ? group.trim() : "");
    }

    public void bind(String channelName, String channelLogo, String serverBase) {
        if (titleView != null) titleView.setText(channelName != null ? channelName : "");
        if (logoView == null) return;
        String logoUrl = PlayUrls.poster(serverBase, channelLogo);
        if (logoUrl == null || logoUrl.isEmpty()) {
            logoView.setImageResource(R.drawable.ic_launcher_foreground);
            return;
        }
        Glide.with(this)
            .load(logoUrl)
            .fitCenter()
            .error(R.drawable.ic_launcher_foreground)
            .into(logoView);
    }

    public void setActive(boolean active) {
        if (active) {
            setVisibility(VISIBLE);
            startEqAnimation();
        } else {
            stopEqAnimation();
            setVisibility(GONE);
        }
    }

    private void startEqAnimation() {
        stopEqAnimation();
        float[] peaks = { 0.45f, 0.75f, 1f, 0.65f, 0.85f, 0.55f, 0.9f };
        long[] delays = { 0L, 120L, 240L, 80L, 200L, 320L, 160L };
        for (int i = 0; i < eqBars.size(); i++) {
            View bar = eqBars.get(i);
            if (bar == null) continue;
            float peak = i < peaks.length ? peaks[i] : 0.8f;
            long delay = i < delays.length ? delays[i] : 0L;
            ValueAnimator anim = ValueAnimator.ofFloat(0.3f, peak);
            anim.setDuration(900L);
            anim.setRepeatCount(ValueAnimator.INFINITE);
            anim.setRepeatMode(ValueAnimator.REVERSE);
            anim.setStartDelay(delay);
            anim.setInterpolator(new LinearInterpolator());
            anim.addUpdateListener(a -> {
                float v = (float) a.getAnimatedValue();
                bar.setScaleY(v);
                bar.setAlpha(0.55f + (v * 0.45f));
            });
            animators.add(anim);
            anim.start();
        }
    }

    private void stopEqAnimation() {
        for (ValueAnimator anim : animators) {
            anim.cancel();
        }
        animators.clear();
        for (View bar : eqBars) {
            if (bar == null) continue;
            bar.setScaleY(1f);
            bar.setAlpha(1f);
        }
    }

    @Override
    protected void onDetachedFromWindow() {
        stopEqAnimation();
        super.onDetachedFromWindow();
    }
}
