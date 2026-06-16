package tv.vix.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.tabs.TabLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MobileProfileFragment extends Fragment {
    private static final int TAB_FAV = 0;
    private static final int TAB_HISTORY = 1;
    private static final int TAB_CONTINUE = 2;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final List<JSONObject> favorites = new ArrayList<>();
    private final List<JSONObject> history = new ArrayList<>();
    private final List<JSONObject> continueItems = new ArrayList<>();

    private TextView nameView;
    private TabLayout tabs;
    private RecyclerView list;
    private ProgressBar loading;
    private MobileProfileLibraryAdapter adapter;
    private int currentTab = TAB_FAV;

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_mobile_profile, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        nameView = view.findViewById(R.id.mobile_profile_name);
        tabs = view.findViewById(R.id.mobile_profile_tabs);
        list = view.findViewById(R.id.mobile_profile_list);
        loading = view.findViewById(R.id.mobile_profile_loading);

        adapter = new MobileProfileLibraryAdapter(requireContext(),
            item -> TvContentHelper.open(requireContext(), item));
        list.setLayoutManager(new LinearLayoutManager(requireContext()));
        list.setAdapter(adapter);

        tabs.addTab(tabs.newTab().setText(R.string.mobile_tab_favorites));
        tabs.addTab(tabs.newTab().setText(R.string.mobile_tab_watched));
        tabs.addTab(tabs.newTab().setText(R.string.mobile_tab_continue));
        tabs.addOnTabSelectedListener(new TabLayout.OnTabSelectedListener() {
            @Override
            public void onTabSelected(TabLayout.Tab tab) {
                currentTab = tab.getPosition();
                styleTabs();
                refreshList();
            }

            @Override public void onTabUnselected(TabLayout.Tab tab) { styleTabs(); }
            @Override public void onTabReselected(TabLayout.Tab tab) { }
        });
        styleTabs();

        view.findViewById(R.id.mobile_profile_switch).setOnClickListener(v ->
            startActivity(new Intent(requireContext(), MobileProfilePickerActivity.class)
                .putExtra(TvProfilePickerActivity.EXTRA_FROM_SWITCH, true)));
        view.findViewById(R.id.mobile_profile_password).setOnClickListener(v ->
            startActivity(new Intent(requireContext(), TvChangePasswordActivity.class)));
        view.findViewById(R.id.mobile_profile_logout).setOnClickListener(v -> {
            NativeAuth.clearToken(requireContext());
            Intent i = new Intent(requireContext(), VixAuthRoutes.loginActivityClass());
            i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            requireActivity().finishAffinity();
        });

        restoreProfile();
    }

    private void restoreProfile() {
        MobileContentCache.ProfileSnapshot snap = MobileContentCache.getProfile();
        if (snap != null) {
            applyProfile(snap);
            return;
        }
        loadProfileFromNetwork();
    }

    private void applyProfile(MobileContentCache.ProfileSnapshot snap) {
        loading.setVisibility(View.GONE);
        nameView.setText(snap.username);
        favorites.clear();
        favorites.addAll(snap.favorites);
        history.clear();
        history.addAll(snap.history);
        continueItems.clear();
        continueItems.addAll(snap.continueItems);
        refreshList();
    }

    private void loadProfileFromNetwork() {
        loading.setVisibility(View.VISIBLE);
        executor.execute(() -> {
            try {
                JSONObject me = new VixApi(requireContext()).me();
                JSONArray fav = new VixApi(requireContext()).favorites();
                JSONArray hist = new VixApi(requireContext()).watchHistory();
                JSONArray cont = new VixApi(requireContext()).watchContinue();
                List<JSONObject> f = new ArrayList<>();
                List<JSONObject> h = new ArrayList<>();
                List<JSONObject> c = new ArrayList<>();
                for (int i = 0; i < fav.length(); i++) f.add(fav.getJSONObject(i));
                for (int i = 0; i < hist.length(); i++) h.add(hist.getJSONObject(i));
                for (int i = 0; i < cont.length(); i++) c.add(cont.getJSONObject(i));
                MobileContentCache.ProfileSnapshot snap = new MobileContentCache.ProfileSnapshot(
                    me.optString("username", "Perfil"), f, h, c);
                MobileContentCache.putProfile(snap);
                requireActivity().runOnUiThread(() -> {
                    if (!isAdded()) return;
                    applyProfile(snap);
                });
            } catch (Exception e) {
                requireActivity().runOnUiThread(() -> {
                    if (!isAdded()) return;
                    loading.setVisibility(View.GONE);
                    if (TvSessionHelper.isAuthError(e)) {
                        TvSessionHelper.redirectToLogin(requireActivity(), e.getMessage());
                    }
                });
            }
        });
    }

    private void styleTabs() {
        ViewGroup tabStrip = (ViewGroup) tabs.getChildAt(0);
        if (tabStrip == null) return;
        for (int i = 0; i < tabStrip.getChildCount(); i++) {
            View tabView = tabStrip.getChildAt(i);
            MobileUi.styleTabBackground(tabView, tabs.getSelectedTabPosition() == i);
        }
    }

    private void refreshList() {
        if (currentTab == TAB_FAV) {
            adapter.setItems(favorites, getString(R.string.mobile_empty_favorites));
        } else if (currentTab == TAB_HISTORY) {
            adapter.setItems(history, getString(R.string.mobile_empty_history));
        } else {
            adapter.setItems(continueItems, getString(R.string.mobile_empty_continue));
        }
    }

    @Override
    public void onDestroyView() {
        executor.shutdown();
        super.onDestroyView();
    }
}
