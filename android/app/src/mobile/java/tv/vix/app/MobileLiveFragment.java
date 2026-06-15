package tv.vix.app;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import androidx.recyclerview.widget.DividerItemDecoration;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MobileLiveFragment extends Fragment {
    private static final String PREF_LAST_CHANNEL = "mobile_last_live_channel_id";
    private static final Set<String> LIVE_COUNTRY_GROUPS = Collections.emptySet();

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final List<JSONObject> channels = new ArrayList<>();
    private final List<JSONObject> categories = new ArrayList<>();

    private PlayerView playerView;
    private RadioVisualizerView radioVisualizer;
    private ExoPlayer player;
    private LinearLayout categoryBar;
    private HorizontalScrollView categoryScroll;
    private RecyclerView list;
    private ProgressBar loading;
    private TextView empty;
    private String serverBase = "";
    private String authToken = "";
    private String selectedGroup = "all";
    private int playingChannelId;
    private boolean channelsLoaded;
    private ChannelAdapter adapter;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_mobile_live, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        serverBase = ServerUrlHelper.fromPrefs(
            requireContext().getSharedPreferences(AppConstants.PREFS, android.content.Context.MODE_PRIVATE));
        authToken = NativeAuth.getToken(requireContext());

        playerView = view.findViewById(R.id.mobile_live_player);
        radioVisualizer = view.findViewById(R.id.mobile_live_radio_viz);
        categoryBar = view.findViewById(R.id.mobile_live_categories);
        categoryScroll = view.findViewById(R.id.mobile_live_categories_scroll);
        list = view.findViewById(R.id.mobile_live_list);
        loading = view.findViewById(R.id.mobile_live_loading);
        empty = view.findViewById(R.id.mobile_live_empty);

        int playerWidth = getResources().getDisplayMetrics().widthPixels - MobileUi.dp(requireContext(), 32);
        int playerHeight = (int) (playerWidth * 9f / 16f);
        ViewGroup.LayoutParams lp = playerView.getLayoutParams();
        lp.height = playerHeight;
        playerView.setLayoutParams(lp);
        if (radioVisualizer != null) {
            ViewGroup.LayoutParams vizLp = radioVisualizer.getLayoutParams();
            vizLp.height = playerHeight;
            radioVisualizer.setLayoutParams(vizLp);
        }

        adapter = new ChannelAdapter();
        list.setLayoutManager(new LinearLayoutManager(requireContext()));
        list.setAdapter(adapter);
        DividerItemDecoration div = new DividerItemDecoration(requireContext(), LinearLayoutManager.VERTICAL);
        div.setDrawable(requireContext().getDrawable(android.R.color.transparent));
        list.addItemDecoration(div);

        restoreFromCacheOrLoad();
    }

    private void restoreFromCacheOrLoad() {
        List<JSONObject> cachedCats = MobileContentCache.getLiveCategories();
        if (!cachedCats.isEmpty()) {
            categories.clear();
            categories.addAll(cachedCats);
            buildCategoryChips();
        }
        MobileContentCache.LiveSnapshot snap = MobileContentCache.getLive(selectedGroup);
        if (snap != null && !snap.channels.isEmpty()) {
            applyChannels(snap.channels);
            return;
        }
        if (categories.isEmpty()) loadCategories();
        else loadChannels();
    }

    private void loadCategories() {
        loading.setVisibility(View.VISIBLE);
        executor.execute(() -> {
            try {
                JSONArray cats = new VixApi(requireContext()).liveCategories();
                List<JSONObject> catList = new ArrayList<>();
                for (int i = 0; i < cats.length(); i++) catList.add(cats.getJSONObject(i));
                requireActivity().runOnUiThread(() -> {
                    if (!isAdded()) return;
                    categories.clear();
                    categories.addAll(catList);
                    buildCategoryChips();
                    loadChannels();
                });
            } catch (Exception e) {
                requireActivity().runOnUiThread(() -> {
                    if (!isAdded()) return;
                    buildCategoryChips();
                    loadChannels();
                });
            }
        });
    }

    private void buildCategoryChips() {
        categoryBar.removeAllViews();
        categoryBar.addView(MobileUi.createCategoryChip(requireContext(), getString(R.string.mobile_live_all),
            "all".equals(selectedGroup), () -> selectGroup("all")));
        boolean radioAdded = false;
        for (int i = 0; i < categories.size(); i++) {
            JSONObject c = categories.get(i);
            String name = c.optString("name", c.optString("group", "")).trim();
            if (name.isEmpty()) continue;
            if (RadioVisualizerView.isRadioGroup(name)) {
                if (!radioAdded) {
                    radioAdded = true;
                    String slug = name;
                    categoryBar.addView(MobileUi.createCategoryChip(requireContext(), name,
                        slug.equals(selectedGroup), () -> selectGroup(slug)));
                }
                continue;
            }
        }
        int shown = radioAdded ? 1 : 0;
        for (int i = 0; i < categories.size() && shown < 12; i++) {
            JSONObject c = categories.get(i);
            String name = c.optString("name", c.optString("group", "")).trim();
            if (name.isEmpty() || RadioVisualizerView.isRadioGroup(name)) continue;
            String slug = name;
            categoryBar.addView(MobileUi.createCategoryChip(requireContext(), name,
                slug.equals(selectedGroup), () -> selectGroup(slug)));
            shown++;
        }
    }

    private void selectGroup(String group) {
        if (group.equals(selectedGroup) && channelsLoaded) return;
        selectedGroup = group;
        buildCategoryChips();
        MobileContentCache.LiveSnapshot snap = MobileContentCache.getLive(selectedGroup);
        if (snap != null && !snap.channels.isEmpty()) {
            applyChannels(snap.channels);
            return;
        }
        loadChannels();
    }

    private void loadChannels() {
        MobileContentCache.LiveSnapshot snap = MobileContentCache.getLive(selectedGroup);
        if (snap != null && !snap.channels.isEmpty()) {
            applyChannels(snap.channels);
            return;
        }
        loading.setVisibility(View.VISIBLE);
        empty.setVisibility(View.GONE);
        MobileContentCache.ensureLive(requireContext(), selectedGroup);
        executor.execute(() -> {
            try {
                String group = "all".equals(selectedGroup) ? null : selectedGroup;
                JSONArray arr = new VixApi(requireContext()).liveChannels(group);
                List<JSONObject> listData = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) listData.add(arr.getJSONObject(i));
                MobileContentCache.putLive(selectedGroup, categories, listData);
                requireActivity().runOnUiThread(() -> {
                    if (!isAdded()) return;
                    applyChannels(listData);
                });
            } catch (Exception e) {
                requireActivity().runOnUiThread(() -> {
                    if (!isAdded()) return;
                    loading.setVisibility(View.GONE);
                    if (TvSessionHelper.isAuthError(e)) {
                        TvSessionHelper.redirectToLogin(requireActivity(), e.getMessage());
                        return;
                    }
                    Toast.makeText(requireContext(),
                        e.getMessage() != null ? e.getMessage() : "Error", Toast.LENGTH_LONG).show();
                    empty.setVisibility(View.VISIBLE);
                });
            }
        });
    }

    private void applyChannels(List<JSONObject> listData) {
        loading.setVisibility(View.GONE);
        channels.clear();
        if ("all".equals(selectedGroup)) {
            for (JSONObject item : listData) {
                String group = item.optString("group_title", item.optString("group", ""));
                if (!LIVE_COUNTRY_GROUPS.contains(group)) channels.add(item);
            }
        } else {
            channels.addAll(listData);
        }
        channelsLoaded = true;
        adapter.notifyDataSetChanged();
        empty.setVisibility(channels.isEmpty() ? View.VISIBLE : View.GONE);
        if (!channels.isEmpty() && playingChannelId <= 0) playInitialChannel();
    }

    private void playInitialChannel() {
        int lastId = requireContext().getSharedPreferences(AppConstants.PREFS, android.content.Context.MODE_PRIVATE)
            .getInt(PREF_LAST_CHANNEL, 0);
        if (lastId > 0) {
            for (int i = 0; i < channels.size(); i++) {
                if (channels.get(i).optInt("id", 0) == lastId) {
                    tuneChannel(i);
                    return;
                }
            }
        }
        tuneChannel(0);
    }

    private void tuneChannel(int index) {
        if (index < 0 || index >= channels.size()) return;
        JSONObject ch = channels.get(index);
        int id = ch.optInt("id", 0);
        if (id <= 0) return;
        playingChannelId = id;
        requireContext().getSharedPreferences(AppConstants.PREFS, android.content.Context.MODE_PRIVATE)
            .edit().putInt(PREF_LAST_CHANNEL, id).apply();
        String url = PlayUrls.livePlayback(
            serverBase,
            authToken,
            id,
            ch.optString("stream_url", ""),
            ch.optInt("direct_source", 0) == 1,
            RadioVisualizerView.isRadioChannel(ch),
            ch.optString("playback_referer", ""),
            null
        );
        if (url == null || url.isEmpty()) {
            Toast.makeText(requireContext(), "Canal no disponible", Toast.LENGTH_SHORT).show();
            return;
        }
        playerView.setVisibility(View.VISIBLE);
        player = MobileUi.playLive(requireContext(), playerView, player, url, authToken);
        updateRadioVisualizer(ch);
        PlaybackScreenWake.keepOn(requireActivity(), playerView);
        adapter.notifyDataSetChanged();
        list.smoothScrollToPosition(index);
    }

    private void updateRadioVisualizer(JSONObject ch) {
        if (radioVisualizer == null) return;
        boolean radio = RadioVisualizerView.isRadioChannel(ch);
        radioVisualizer.setActive(radio);
        if (radio) {
            radioVisualizer.bind(
                ch.optString("name", ""),
                ch.optString("logo", ""),
                serverBase);
        }
        playerView.setVisibility(radio ? View.INVISIBLE : View.VISIBLE);
    }

    /** Detiene audio/video al salir de la pestaña En vivo (el fragment sigue en memoria). */
    public void suspendPlayback() {
        if (player != null) {
            MobileUi.stopPlayer(player);
            player = null;
        }
        if (playerView != null) {
            playerView.setPlayer(null);
            playerView.setVisibility(View.GONE);
        }
        if (radioVisualizer != null) radioVisualizer.setActive(false);
        if (isAdded()) PlaybackScreenWake.release(requireActivity(), playerView);
        if (adapter != null) adapter.notifyDataSetChanged();
    }

    /** Reanuda el último canal al volver a En vivo. */
    public void resumePlayback() {
        if (!isAdded() || playingChannelId <= 0 || channels.isEmpty()) return;
        if (player != null) {
            player.play();
            return;
        }
        for (int i = 0; i < channels.size(); i++) {
            if (channels.get(i).optInt("id", 0) == playingChannelId) {
                tuneChannel(i);
                return;
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (!isHidden()) resumePlayback();
    }

    @Override
    public void onPause() {
        suspendPlayback();
        super.onPause();
    }

    @Override
    public void onHiddenChanged(boolean hidden) {
        super.onHiddenChanged(hidden);
        if (hidden) suspendPlayback();
        else resumePlayback();
    }

    @Override
    public void onDestroyView() {
        stopPlayback();
        executor.shutdown();
        super.onDestroyView();
    }

    private void stopPlayback() {
        MobileUi.stopPlayer(player);
        player = null;
        if (playerView != null) {
            playerView.setPlayer(null);
            playerView.setVisibility(View.GONE);
        }
        if (radioVisualizer != null) radioVisualizer.setActive(false);
        if (isAdded()) PlaybackScreenWake.release(requireActivity(), playerView);
        playingChannelId = 0;
        channelsLoaded = false;
    }

    private class ChannelAdapter extends RecyclerView.Adapter<ChannelAdapter.H> {
        @NonNull
        @Override
        public H onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_mobile_channel, parent, false);
            return new H(v);
        }

        @Override
        public void onBindViewHolder(@NonNull H holder, int position) {
            JSONObject ch = channels.get(position);
            int id = ch.optInt("id", 0);
            holder.name.setText(ch.optString("name", "Canal"));
            String group = ch.optString("group", ch.optString("category", ""));
            holder.group.setText(group.isEmpty() ? "En vivo" : group);
            boolean playing = id == playingChannelId;
            holder.check.setVisibility(playing ? View.VISIBLE : View.GONE);
            String logo = ch.optString("logo", "");
            if (logo.isEmpty()) holder.logo.setImageDrawable(null);
            else MobileImageLoader.posterFit(holder.logo.getContext(), holder.logo,
                PlayUrls.poster(serverBase, logo));
            holder.itemView.setOnClickListener(v -> tuneChannel(position));
        }

        @Override
        public int getItemCount() {
            return channels.size();
        }

        class H extends RecyclerView.ViewHolder {
            final ImageView logo;
            final TextView name;
            final TextView group;
            final TextView check;

            H(View itemView) {
                super(itemView);
                logo = itemView.findViewById(R.id.mobile_ch_logo);
                name = itemView.findViewById(R.id.mobile_ch_name);
                group = itemView.findViewById(R.id.mobile_ch_group);
                check = itemView.findViewById(R.id.mobile_ch_check);
            }
        }
    }
}
