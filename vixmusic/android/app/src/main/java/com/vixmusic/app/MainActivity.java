package com.vixmusic.app;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        configureWebView();
    }

    @Override
    public void onPause() {
        super.onPause();
        keepWebViewAlive();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepWebViewAlive();
    }

    private void keepWebViewAlive() {
        // Evita que Android pause el WebView y corte el audio en segundo plano
        Bridge bridge = getBridge();
        if (bridge != null) {
            WebView webView = bridge.getWebView();
            if (webView != null) {
                webView.onResume();
            }
        }
    }

    private void configureWebView() {
        Bridge bridge = getBridge();
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        if (webView == null) return;
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
