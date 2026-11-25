package expo.modules.ssh

import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.ceil

/**
 * Android's bottom system gesture zone and navigation bar in dp, rounded up so the terminal's reveal strip
 * clears the zone entirely (key-bar-autohide S5). Null before Android 10 (no gesture navigation, the app then
 * uses its fallback) or when the window has no insets yet.
 */
internal fun systemGestureInsetsDp(sdk: Int, mandatoryBottomPx: Int?, navigationBottomPx: Int?, density: Float): Map<String, Double>? {
  if (sdk < 29 || mandatoryBottomPx == null || navigationBottomPx == null || !(density > 0f)) return null
  if (mandatoryBottomPx < 0 || navigationBottomPx < 0) return null
  return mapOf(
    "mandatoryBottom" to ceil(mandatoryBottomPx / density.toDouble()),
    "navigationBottom" to ceil(navigationBottomPx / density.toDouble()),
  )
}

/** Reads the root window insets of [view] (the activity's decor view); call on the main thread. */
internal fun readSystemGestureInsets(view: View, sdk: Int): Map<String, Double>? {
  val insets = ViewCompat.getRootWindowInsets(view) ?: return null
  return systemGestureInsetsDp(
    sdk,
    insets.getInsets(WindowInsetsCompat.Type.mandatorySystemGestures()).bottom,
    insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom,
    view.resources.displayMetrics.density,
  )
}
