package tv.vix.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.animation.DecelerateInterpolator;
import android.view.inputmethod.InputMethodManager;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {
    public static final String PREFS = "vixtv_prefs";
    public static final String KEY_SERVER = "server_url";
    private static final String KEY_WEB_CACHE_BUILD = "webview_cache_build";
    private static final int REQ_NOTIFICATIONS = 42;

    private WebView webView;
    private ProgressBar progressBar;
    private View splashPanel;
    private View errorPanel;
    private boolean mobileRevealDone = false;
    private TextView errorText;
    private boolean errorVisible = false;
    private boolean pageReady = false;
    private View nativeLoginPanel;
    private EditText nativeLoginUser;
    private EditText nativeLoginPass;
    private TextView nativeLoginError;
    private TextView nativeLoginServer;
    private Button nativeLoginBtn;
    private final ExecutorService authExecutor = Executors.newSingleThreadExecutor();
    private boolean sessionInjected = false;
    private final Runnable mobileSplashTimeout = this::forceRevealMobileSplash;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        progressBar = findViewById(R.id.progress);
        splashPanel = findViewById(R.id.splash_panel);
        errorPanel = findViewById(R.id.error_panel);

        if (BuildConfig.PLATFORM.equals("mobile")) {
            if (splashPanel != null) {
                splashPanel.setVisibility(View.VISIBLE);
                splashPanel.setAlpha(1f);
            }
            webView.setAlpha(0f);
            progressBar.setVisibility(View.GONE);
            webView.postDelayed(mobileSplashTimeout, 8000);
        }
        errorText = findViewById(R.id.error_text);

        findViewById(R.id.btn_retry).setOnClickListener(v -> loadApp());
        findViewById(R.id.btn_settings).setOnClickListener(v -> openSettings());
        setupNativeLoginUi();

        ServerUrlHelper.ensureDefault(getSharedPreferences(PREFS, MODE_PRIVATE));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        if (BuildConfig.PLATFORM.equals("tv")) {
            settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        } else {
            settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
            clearStaleWebCacheIfNeeded();
        }

        String ua = settings.getUserAgentString();
        settings.setUserAgentString(ua + " VixTV/" + BuildConfig.VERSION_NAME + " " + BuildConfig.PLATFORM);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new VixJsBridge(this), "VixTvAndroid");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (BuildConfig.PLATFORM.equals("mobile")) {
                    progressBar.setVisibility(View.GONE);
                    return;
                }
                progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
                progressBar.setProgress(newProgress);
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                errorVisible = false;
                errorPanel.setVisibility(View.GONE);
                pageReady = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                injectNativeBridge();
                if (BuildConfig.PLATFORM.equals("mobile")) {
                    webView.postDelayed(() -> forceRevealMobileSplash(), 4500);
                }
                injectNativeSession();
                if (BuildConfig.PLATFORM.equals("tv")) {
                    UpdateChecker.checkAsync(MainActivity.this);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showError(getString(R.string.error_load));
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    return false;
                }
                return true;
            }
        });

        if (BuildConfig.PLATFORM.equals("tv")) {
            webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
            webView.setFocusable(true);
            webView.setFocusableInTouchMode(true);
            webView.requestFocus(View.FOCUS_DOWN);
            PlaybackScreenWake.keepOn(this, webView);
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }

        if (BuildConfig.PLATFORM.equals("tv") && !NativeAuth.hasToken(this)) {
            showNativeLogin(null);
        } else {
            loadApp();
        }
        requestUpdatePermissionIfNeeded();
        UpdateChecker.checkAsync(this);
        UpdateChecker.handleUpdateIntent(this, getIntent());
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
        if (BuildConfig.PLATFORM.equals("tv") && nativeLoginPanel != null) {
            if (nativeLoginServer != null) {
                nativeLoginServer.setText(getServerUrl());
            }
            if (!NativeAuth.hasToken(this) && nativeLoginPanel.getVisibility() != View.VISIBLE) {
                showNativeLogin(null);
            }
        }
        if (webView != null) {
            webView.onResume();
            if (errorVisible) {
                loadApp();
            } else if (BuildConfig.PLATFORM.equals("tv") && nativeLoginPanel != null
                && nativeLoginPanel.getVisibility() != View.VISIBLE) {
                webView.requestFocus(View.FOCUS_DOWN);
                UpdateChecker.checkAsync(this);
            }
        }
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

    private String escapeJsString(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\").replace("'", "\\'");
    }

    private boolean isEnterKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_DPAD_CENTER
            || keyCode == KeyEvent.KEYCODE_ENTER
            || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
            || keyCode == KeyEvent.KEYCODE_BUTTON_A
            || keyCode == KeyEvent.KEYCODE_BUTTON_SELECT
            || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY;
    }

    private boolean isSoftKeyboardActive() {
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        return imm != null && imm.isAcceptingText();
    }

    private void injectNativeBridge() {
        String server = escapeJsString(getServerUrl());
        String token = escapeJsString(NativeAuth.getToken(this));
        String js = "(function(){"
            + "window.VIXTV_NATIVE={platform:'" + BuildConfig.PLATFORM + "',app:'vixtv',version:'"
            + BuildConfig.VERSION_NAME + "',versionCode:" + BuildConfig.VERSION_CODE + ",server:'" + server + "'};"
            + "if(typeof refreshVixNativeBridge==='function'){refreshVixNativeBridge();}"
            + "try{"
                + "var nt='" + token + "';"
                + "if(!nt&&window.VixTvAndroid&&VixTvAndroid.getAuthToken){nt=VixTvAndroid.getAuthToken();}"
                + "if(nt&&nt.length>10&&typeof applyNativeSession==='function'){applyNativeSession(nt);return;}"
                + "if(nt&&nt.length>10){localStorage.setItem('vixtv_token',nt);}"
            + "}catch(e){}"
            + "if(typeof refreshVixNativeBridge==='function')return;"
            + "document.documentElement.classList.add('vix-" + BuildConfig.PLATFORM + "','vix-native');"
            + "if(typeof applyVixPlatformUi==='function')applyVixPlatformUi();"
            + "if(typeof initTvRemoteNav==='function')initTvRemoteNav();"
            + "if(typeof trackTvFocus==='function')trackTvFocus();"
            + "if(typeof focusTvScreenStart==='function')setTimeout(focusTvScreenStart,120);"
            + "if(typeof checkNativeAppUpdate==='function')checkNativeAppUpdate();"
            + "})();";
        webView.evaluateJavascript(js, null);
    }

    private void injectNativeSession() {
        injectNativeSessionAttempt(0);
    }

    private void injectNativeSessionAttempt(int attempt) {
        if (webView == null) return;
        String nativeToken = NativeAuth.getToken(this);
        String escapedNative = escapeJsString(nativeToken != null ? nativeToken : "");
        String js = "(function(){"
            + "var wt='';try{wt=localStorage.getItem('vixtv_token')||'';}catch(e){}"
            + "var nt='" + escapedNative + "';"
            + "var use=(wt&&wt.length>20)?wt:((nt&&nt.length>20)?nt:'');"
            + "if(!use)return false;"
            + "try{if(use!==nt&&window.VixTvAndroid&&VixTvAndroid.saveAuthToken){VixTvAndroid.saveAuthToken(use);}}catch(e){}"
            + "if(typeof applyNativeSession==='function'){applyNativeSession(use);return true;}"
            + "try{localStorage.setItem('vixtv_token',use);}catch(e){}"
            + "return false;"
            + "})();";
        webView.evaluateJavascript(js, value -> {
            boolean ok = value != null && value.replace("\"", "").equals("true");
            if (ok) {
                sessionInjected = true;
                return;
            }
            if (attempt < 8) {
                webView.postDelayed(() -> injectNativeSessionAttempt(attempt + 1), 350);
            }
        });
    }

    void onWebBootComplete() {
        if (BuildConfig.PLATFORM.equals("mobile") && webView != null) {
            webView.removeCallbacks(mobileSplashTimeout);
        }
        hideNativeLogin();
        if (!BuildConfig.PLATFORM.equals("mobile")) {
            if (webView != null) {
                webView.requestFocus(View.FOCUS_DOWN);
            }
            return;
        }
        revealMobileWebView();
    }

    private void revealMobileWebView() {
        if (mobileRevealDone || webView == null) return;
        mobileRevealDone = true;
        webView.animate()
            .alpha(1f)
            .setDuration(340)
            .setInterpolator(new DecelerateInterpolator())
            .withEndAction(() -> webView.requestFocus(View.FOCUS_DOWN))
            .start();
        if (splashPanel != null && splashPanel.getVisibility() == View.VISIBLE) {
            splashPanel.animate()
                .alpha(0f)
                .setDuration(300)
                .setInterpolator(new DecelerateInterpolator())
                .withEndAction(() -> {
                    splashPanel.setVisibility(View.GONE);
                    splashPanel.setAlpha(1f);
                })
                .start();
        }
    }

    private void forceRevealMobileSplash() {
        if (!BuildConfig.PLATFORM.equals("mobile") || mobileRevealDone) return;
        revealMobileWebView();
        if (webView != null) {
            webView.evaluateJavascript(
                "(function(){try{"
                    + "if(typeof showScreen==='function'&&!document.getElementById('app')?.classList.contains('active')){"
                    + "showScreen('login-screen');}"
                + "}catch(e){}})();",
                null
            );
        }
    }

    void onWebBootFailed(String message) {
        sessionInjected = false;
        NativeAuth.clearToken(this);
        clearWebAuthStorage();
        if (BuildConfig.PLATFORM.equals("mobile")) {
            if (webView != null) {
                webView.removeCallbacks(mobileSplashTimeout);
            }
            revealMobileWebView();
            if (webView != null) {
                webView.evaluateJavascript(
                    "(function(){try{"
                        + "if(typeof persistAuthToken==='function')persistAuthToken(null);"
                        + "window.__vixBootAttempted=false;"
                        + "if(typeof showScreen==='function')showScreen('login-screen');"
                        + "var err=document.getElementById('login-error');"
                        + "if(err)err.textContent="
                        + "'" + escapeJsString(message == null || message.trim().isEmpty()
                            ? "Sesión expirada. Ingresa de nuevo."
                            : message.trim()) + "';"
                    + "}catch(e){}})();",
                    null
                );
            }
            return;
        }
        String msg = message == null || message.trim().isEmpty()
            ? "No se pudo entrar a la app"
            : message.trim();
        showNativeLogin(msg);
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }

    private void clearWebAuthStorage() {
        if (webView == null) return;
        webView.evaluateJavascript(
            "(function(){try{"
                + "localStorage.removeItem('vixtv_token');"
                + "localStorage.removeItem('xupertv_token');"
            + "}catch(e){}})();",
            null
        );
    }

    void setupNativeLoginUi() {
        if (!BuildConfig.PLATFORM.equals("tv")) return;
        nativeLoginPanel = findViewById(R.id.native_login_panel);
        if (nativeLoginPanel == null) return;
        nativeLoginUser = findViewById(R.id.native_login_user);
        nativeLoginPass = findViewById(R.id.native_login_pass);
        nativeLoginError = findViewById(R.id.native_login_error);
        nativeLoginServer = findViewById(R.id.native_login_server);
        nativeLoginBtn = findViewById(R.id.native_login_btn);
        Button settings = findViewById(R.id.native_login_settings);
        if (nativeLoginServer != null) {
            nativeLoginServer.setText(getServerUrl());
        }
        if (nativeLoginBtn != null) {
            nativeLoginBtn.setOnClickListener(v -> {
                String user = nativeLoginUser != null ? nativeLoginUser.getText().toString().trim() : "";
                String pass = nativeLoginPass != null ? nativeLoginPass.getText().toString() : "";
                performNativeLogin(user, pass, true);
            });
        }
        if (settings != null) {
            settings.setOnClickListener(v -> openSettings());
        }
    }

    void showNativeLogin(String message) {
        if (!BuildConfig.PLATFORM.equals("tv") || nativeLoginPanel == null) return;
        sessionInjected = false;
        nativeLoginPanel.setVisibility(View.VISIBLE);
        if (nativeLoginServer != null) {
            nativeLoginServer.setText(getServerUrl());
        }
        if (message != null && nativeLoginError != null) {
            nativeLoginError.setText(message);
        }
        if (nativeLoginUser != null) {
            nativeLoginUser.requestFocus();
        }
    }

    void hideNativeLogin() {
        if (nativeLoginPanel != null) {
            nativeLoginPanel.setVisibility(View.GONE);
        }
    }

    void performNativeLogin(String username, String password, boolean fromUi) {
        if (!BuildConfig.PLATFORM.equals("tv")) return;
        if (username == null || username.trim().isEmpty() || password == null || password.isEmpty()) {
            if (nativeLoginError != null) {
                nativeLoginError.setText("Escribe usuario y contraseña");
            }
            Toast.makeText(this, "Escribe usuario y contraseña", Toast.LENGTH_SHORT).show();
            return;
        }
        if (nativeLoginBtn != null) nativeLoginBtn.setEnabled(false);
        if (nativeLoginError != null) nativeLoginError.setText(getString(R.string.native_login_connecting));
        Toast.makeText(this, getString(R.string.native_login_connecting), Toast.LENGTH_SHORT).show();

        authExecutor.execute(() -> {
            NativeAuth.Result result = NativeAuth.login(this, username.trim(), password);
            runOnUiThread(() -> {
                if (nativeLoginBtn != null) nativeLoginBtn.setEnabled(true);
                if (!result.ok) {
                    if (nativeLoginError != null) nativeLoginError.setText(result.error);
                    Toast.makeText(this, result.error, Toast.LENGTH_LONG).show();
                    return;
                }
                NativeAuth.saveToken(this, result.token);
                sessionInjected = false;
                if (nativeLoginError != null) {
                    nativeLoginError.setText("Entrando a Vix TV…");
                }
                if (!pageReady) {
                    clearWebAuthStorage();
                    loadApp();
                } else {
                    clearWebAuthStorage();
                    injectNativeSession();
                }
                if (result.needsProfileSetup) {
                    Toast.makeText(this, "Crea tu perfil en pantalla", Toast.LENGTH_LONG).show();
                } else {
                    Toast.makeText(this, "Bienvenido a Vix TV", Toast.LENGTH_SHORT).show();
                }
            });
        });
    }

    private String getServerUrl() {
        return ServerUrlHelper.fromPrefs(getSharedPreferences(PREFS, MODE_PRIVATE));
    }

    private void clearStaleWebCacheIfNeeded() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        int lastBuild = prefs.getInt(KEY_WEB_CACHE_BUILD, 0);
        if (lastBuild == BuildConfig.VERSION_CODE) return;
        if (webView != null) {
            webView.clearCache(true);
            CookieManager.getInstance().removeAllCookies(null);
            CookieManager.getInstance().flush();
        }
        NativeAuth.clearToken(this);
        prefs.edit().putInt(KEY_WEB_CACHE_BUILD, BuildConfig.VERSION_CODE).apply();
    }

    private void loadApp() {
        String base = getServerUrl();
        String url = base + "/?vix_platform=" + BuildConfig.PLATFORM
            + "&vix_native=1&vix_build=" + BuildConfig.VERSION_CODE
            + "&_=" + BuildConfig.VERSION_CODE;
        webView.loadUrl(url);
    }

    private void showError(String message) {
        errorVisible = true;
        errorText.setText(message + "\n\n" + getServerUrl());
        errorPanel.setVisibility(View.VISIBLE);
    }

    private void openSettings() {
        startActivity(new Intent(this, SettingsActivity.class));
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        authExecutor.shutdownNow();
        PlaybackScreenWake.release(this, webView);
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private boolean injectTvKeyEvent(int keyCode) {
        if (!BuildConfig.PLATFORM.equals("tv") || webView == null) return false;
        String key = null;
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP:
                key = "ArrowUp";
                break;
            case KeyEvent.KEYCODE_DPAD_DOWN:
                key = "ArrowDown";
                break;
            case KeyEvent.KEYCODE_DPAD_LEFT:
                key = "ArrowLeft";
                break;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                key = "ArrowRight";
                break;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
            case KeyEvent.KEYCODE_BUTTON_A:
            case KeyEvent.KEYCODE_BUTTON_SELECT:
                key = "Enter";
                break;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                key = "Enter";
                break;
            default:
                return false;
        }
        final String arrowKey = key;
        webView.post(() -> webView.evaluateJavascript(
            "(function(){"
                + "try{"
                    + "if(typeof refreshVixNativeBridge==='function'&&!window.__vixTvNavBound){refreshVixNativeBridge();}"
                    + "var onLogin=document.getElementById('login-screen')&&document.getElementById('login-screen').classList.contains('active');"
                    + "if(onLogin&&'" + arrowKey + "'==='Enter'){"
                        + "var u=document.getElementById('login-user');"
                        + "var p=document.getElementById('login-pass');"
                        + "if(u&&p&&u.value.trim()&&p.value&&typeof performLogin==='function'){performLogin();return;}"
                    + "}"
                    + "if(typeof processTvRemoteKey==='function'){processTvRemoteKey('"
                    + arrowKey + "',{preventDefault:function(){},stopPropagation:function(){}});return;}"
                    + "if(typeof handleTvKey==='function'){handleTvKey('" + arrowKey + "');return;}"
                    + "if(typeof focusTvScreenStart==='function'){focusTvScreenStart();}"
                + "}catch(e){}"
            + "})();",
            null
        ));
        return true;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int keyCode = event.getKeyCode();
            if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
                triggerWebBack();
                return true;
            }
            if (isEnterKey(keyCode) && isSoftKeyboardActive()) {
                return super.dispatchKeyEvent(event);
            }
            if (nativeLoginPanel != null && nativeLoginPanel.getVisibility() == View.VISIBLE) {
                if (isEnterKey(keyCode) && nativeLoginBtn != null) {
                    nativeLoginBtn.performClick();
                    return true;
                }
                return super.dispatchKeyEvent(event);
            }
            if (injectTvKeyEvent(keyCode)) return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) {
            openSettings();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private void triggerWebBack() {
        if (webView == null) {
            moveTaskToBack(true);
            return;
        }
        webView.evaluateJavascript(
            "(function(){return !!(typeof handleAppBack==='function'&&handleAppBack());})();",
            value -> runOnUiThread(() -> {
                String handled = value == null ? "" : value.replace("\"", "").trim();
                if (!"true".equals(handled)) {
                    moveTaskToBack(true);
                }
            })
        );
    }
}
