package tv.vix.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.annotation.IdRes;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentManager;
import androidx.fragment.app.FragmentTransaction;

import com.google.android.material.bottomnavigation.BottomNavigationView;

public class MobileMainActivity extends AppCompatActivity {
    private static final int REQ_NOTIFICATIONS = 9002;
    private static final String TAG_HOME = "mobile_tab_home";
    private static final String TAG_LIVE = "mobile_tab_live";
    private static final String TAG_PROFILE = "mobile_tab_profile";

    private Fragment homeFragment;
    private Fragment liveFragment;
    private Fragment profileFragment;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_mobile_main);

        FragmentManager fm = getSupportFragmentManager();
        homeFragment = fm.findFragmentByTag(TAG_HOME);
        liveFragment = fm.findFragmentByTag(TAG_LIVE);
        profileFragment = fm.findFragmentByTag(TAG_PROFILE);

        BottomNavigationView nav = findViewById(R.id.mobile_bottom_nav);
        nav.setItemIconTintList(getColorStateList(R.color.mobile_nav_item));
        nav.setItemTextColor(getColorStateList(R.color.mobile_nav_item));
        nav.setOnItemSelectedListener(item -> {
            showTab(item.getItemId());
            return true;
        });

        MobileContentCache.beginSession(this);

        if (savedInstanceState == null) {
            if (homeFragment == null) {
                homeFragment = new MobileHomeFragment();
                fm.beginTransaction()
                    .add(R.id.mobile_fragment_host, homeFragment, TAG_HOME)
                    .commit();
            }
            nav.setSelectedItemId(R.id.mobile_nav_home);
        } else {
            int visible = savedInstanceState.getInt("mobile_visible_tab", R.id.mobile_nav_home);
            showTab(visible);
            nav.setSelectedItemId(visible);
        }

        requestUpdatePermissionIfNeeded();
        UpdateChecker.checkAsync(this);
        UpdateChecker.handleUpdateIntent(this, getIntent());
    }

    private void showTab(@IdRes int itemId) {
        FragmentManager fm = getSupportFragmentManager();
        FragmentTransaction tx = fm.beginTransaction();
        tx.setReorderingAllowed(true);

        Fragment target;
        if (itemId == R.id.mobile_nav_live) {
            if (liveFragment == null) {
                liveFragment = new MobileLiveFragment();
                tx.add(R.id.mobile_fragment_host, liveFragment, TAG_LIVE);
            }
            target = liveFragment;
        } else if (itemId == R.id.mobile_nav_profile) {
            if (profileFragment == null) {
                profileFragment = new MobileProfileFragment();
                tx.add(R.id.mobile_fragment_host, profileFragment, TAG_PROFILE);
            }
            target = profileFragment;
        } else {
            if (homeFragment == null) {
                homeFragment = new MobileHomeFragment();
                tx.add(R.id.mobile_fragment_host, homeFragment, TAG_HOME);
            }
            target = homeFragment;
        }

        if (homeFragment != null && homeFragment != target && homeFragment.isAdded()) tx.hide(homeFragment);
        if (liveFragment != null && liveFragment != target && liveFragment.isAdded()) {
            tx.hide(liveFragment);
            if (liveFragment instanceof MobileLiveFragment) {
                ((MobileLiveFragment) liveFragment).suspendPlayback();
            }
        }
        if (profileFragment != null && profileFragment != target && profileFragment.isAdded()) tx.hide(profileFragment);
        tx.show(target);
        tx.commit();

        if (target instanceof MobileLiveFragment) {
            ((MobileLiveFragment) target).resumePlayback();
        }
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        BottomNavigationView nav = findViewById(R.id.mobile_bottom_nav);
        if (nav != null) outState.putInt("mobile_visible_tab", nav.getSelectedItemId());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        UpdateChecker.handleUpdateIntent(this, intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        UpdateChecker.checkAsync(this);
    }

    public void selectTab(@IdRes int itemId) {
        BottomNavigationView nav = findViewById(R.id.mobile_bottom_nav);
        if (nav != null) nav.setSelectedItemId(itemId);
    }

    private void requestUpdatePermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
            }
        }
    }
}
