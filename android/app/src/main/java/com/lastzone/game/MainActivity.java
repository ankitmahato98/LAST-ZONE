package com.lastzone.game;

import android.os.Bundle;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * LAST ZONE host activity.
 *
 * The game is a WebGL surface that must own the whole screen, so on top of the
 * Capacitor bridge this activity:
 *
 *  - hides the status and navigation bars (immersive mode) and re-hides them
 *    whenever the window regains focus, with transient bars on swipe so the user
 *    can still reach the system UI;
 *  - keeps the screen awake while a match is running (a game that dims after
 *    30 seconds of aiming is not a game);
 *  - draws edge to edge with a dark window background, matching the game's own
 *    background colour so there is no white flash during startup or rotation.
 *
 * The WebView itself, its asset loading and the plugin bridge are untouched -
 * all gameplay, rendering and input still come from the Three.js build in
 * `src/`, synced into `android/app/src/main/assets/public` by `cap sync`.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Never let the display sleep while the game is in the foreground.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Draw behind the system bars; Capacitor's edge-to-edge handling and the
        // game's CSS safe-area insets keep the HUD out from under them.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            // Returning from the app switcher or a system dialog: go immersive again.
            hideSystemBars();
        }
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());

        if (controller == null) {
            return;
        }

        // Swiping from an edge reveals the bars temporarily; they hide again by
        // themselves, which is what "immersive" means for a full screen game.
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
