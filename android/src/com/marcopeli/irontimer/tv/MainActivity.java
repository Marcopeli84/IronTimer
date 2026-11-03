package com.marcopeli.irontimer.tv;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.speech.tts.TextToSpeech;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.Locale;

/** Opens the Iron Timer TV page full screen: screen always on, audio without a tap, voice from the system. */
public class MainActivity extends Activity {
    private static final String URL = "https://marcopeli84.github.io/IronTimer/tv.html";
    private static final String OFFLINE = "<body style='background:#000;color:#81F105;font:32px sans-serif;"
            + "display:flex;height:90vh;align-items:center;justify-content:center'>Nessuna connessione, riprovo…</body>";
    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady;
    private final Handler handler = new Handler();

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            int r = tts.setLanguage(Locale.ITALIAN);
            ttsReady = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED;
        });
        web = new WebView(this);
        web.setBackgroundColor(0xFF000000);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Voice(), "IronTTS");
        web.setWebViewClient(new WebViewClient() {
            @Override public void onReceivedError(WebView v, WebResourceRequest q, WebResourceError e) {
                if (!q.isForMainFrame()) return;
                v.loadData(OFFLINE, "text/html; charset=utf-8", "UTF-8");
                handler.postDelayed(() -> web.loadUrl(URL), 5000);
            }
        });
        setContentView(web);
        web.requestFocus();
        if (b == null) web.loadUrl(URL); else web.restoreState(b);
    }

    private class Voice {
        @JavascriptInterface public void speak(String text) {
            if (ttsReady) tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "iron");
        }
    }

    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        if (k == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) { // hand play/pause to the page, which does not get it by itself
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0)
                web.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'MediaPlayPause',keyCode:179}))", null);
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); web.saveState(b); }
    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        tts.shutdown();
        web.destroy();
        super.onDestroy();
    }
}
