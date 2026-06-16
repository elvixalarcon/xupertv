package tv.vix.app;

import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public final class MobileWorldCupAdapter extends RecyclerView.Adapter<MobileWorldCupAdapter.H> {
  public interface Listener {
    void onMatchClick(JSONObject match);
  }

  private final List<JSONObject> matches = new ArrayList<>();
  private final Listener listener;

  public MobileWorldCupAdapter(Listener listener) {
    this.listener = listener;
  }

  public void setMatches(JSONArray array) {
    matches.clear();
    if (array != null) {
      for (int i = 0; i < array.length(); i++) {
        matches.add(array.optJSONObject(i));
      }
    }
    notifyDataSetChanged();
  }

  @NonNull
  @Override
  public H onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
    View v = LayoutInflater.from(parent.getContext())
      .inflate(R.layout.item_mobile_worldcup_match, parent, false);
    return new H(v);
  }

  @Override
  public void onBindViewHolder(@NonNull H holder, int position) {
    JSONObject match = matches.get(position);
    if (match == null) return;

    String badge = match.optString("badge", match.optString("time", ""));
    boolean live = "in".equals(match.optString("state", ""));
    holder.badge.setText(badge);
    holder.badge.setTextColor(live
      ? holder.itemView.getContext().getColor(android.R.color.holo_red_light)
      : Color.WHITE);

    JSONObject home = match.optJSONObject("home");
    JSONObject away = match.optJSONObject("away");
    String homeLogo = home != null ? home.optString("logo", "") : "";
    String awayLogo = away != null ? away.optString("logo", "") : "";
    if (!homeLogo.isEmpty()) {
      MobileImageLoader.posterFit(holder.homeFlag.getContext(), holder.homeFlag, homeLogo);
    } else {
      holder.homeFlag.setImageDrawable(null);
    }
    if (!awayLogo.isEmpty()) {
      MobileImageLoader.posterFit(holder.awayFlag.getContext(), holder.awayFlag, awayLogo);
    } else {
      holder.awayFlag.setImageDrawable(null);
    }

    int homeColor = parseColor(home != null ? home.optString("color", "") : "", 0xFF1A3A5C);
    int awayColor = parseColor(away != null ? away.optString("color", "") : "", 0xFF0D2137);
    GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.BL_TR,
      new int[]{homeColor, awayColor});
    bg.setCornerRadius(MobileUi.dp(holder.visual.getContext(), 8));
    holder.visual.setBackground(bg);

    holder.brand.setText(match.optString("channel_name", "DSports"));

    String competition = match.optString("competition", "Copa Mundial de la FIFA 2026");
    String time = match.optString("time", "");
    String dateLabel = match.optString("date_label", "");
    String when;
    if (live) {
      when = time;
    } else if (!dateLabel.isEmpty() && !time.isEmpty()) {
      when = dateLabel + " · " + time;
    } else {
      when = !time.isEmpty() ? time : dateLabel;
    }
    holder.line1.setText(when.isEmpty() ? competition : when + " · " + competition);

    String homeName = home != null ? home.optString("name", "Local") : "Local";
    String awayName = away != null ? away.optString("name", "Visitante") : "Visitante";
    holder.line2.setText(homeName + " vs. " + awayName);

    holder.itemView.setOnClickListener(v -> {
      if (listener != null) listener.onMatchClick(match);
    });
  }

  @Override
  public int getItemCount() {
    return matches.size();
  }

  private static int parseColor(String hex, int fallback) {
    try {
      if (hex == null || hex.isEmpty()) return fallback;
      if (!hex.startsWith("#")) hex = "#" + hex;
      return Color.parseColor(hex);
    } catch (Exception e) {
      return fallback;
    }
  }

  static class H extends RecyclerView.ViewHolder {
    final FrameLayout visual;
    final TextView badge;
    final ImageView homeFlag;
    final ImageView awayFlag;
    final TextView brand;
    final TextView line1;
    final TextView line2;

    H(View itemView) {
      super(itemView);
      visual = itemView.findViewById(R.id.mobile_wc_visual);
      badge = itemView.findViewById(R.id.mobile_wc_badge);
      homeFlag = itemView.findViewById(R.id.mobile_wc_home_flag);
      awayFlag = itemView.findViewById(R.id.mobile_wc_away_flag);
      brand = itemView.findViewById(R.id.mobile_wc_brand);
      line1 = itemView.findViewById(R.id.mobile_wc_line1);
      line2 = itemView.findViewById(R.id.mobile_wc_line2);
    }
  }
}
