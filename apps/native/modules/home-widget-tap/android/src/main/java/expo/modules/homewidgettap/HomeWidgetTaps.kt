package expo.modules.homewidgettap

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import java.util.concurrent.ConcurrentHashMap

/**
 * Taps on the home-screen widget's water and "Taken" buttons (#505), in this
 * app process only. The widget's receiver, which the app does not export,
 * records a tap just before it opens the app; the quick-log screen takes it
 * when the link arrives (`HomeWidgetTapModule.takeTap`). Only a link with a
 * fresh tap behind it saves at once. Any other app can open the same link,
 * but cannot reach the receiver, so it gets the entry ready to save instead.
 */
object HomeWidgetTaps {
  /** The buttons that write. "Log…" only opens the picker. */
  private val WRITE_ACTIONS = setOf("water", "supplement")

  /** Per button: when it was last tapped (elapsed realtime), until the app takes it. */
  private val taps = ConcurrentHashMap<String, Long>()

  /**
   * The button a widget click writes for, or `null`. The click is the
   * widget library's (`react-native-android-widget`): an `OPEN_URI` action
   * whose link is `openvalens://quick-log?widget=<action>`.
   */
  fun writeActionOf(context: Context, intent: Intent): String? {
    if (intent.action != "${context.packageName}.WIDGET_CLICK") return null
    if (intent.getStringExtra("clickAction") != "OPEN_URI") return null
    val link = intent.getBundleExtra("clickActionData")?.getString("uri") ?: return null
    val uri = Uri.parse(link)
    if (uri.scheme != "openvalens" || uri.host != "quick-log" || !uri.isHierarchical) return null
    return uri.getQueryParameter("widget")?.takeIf { it in WRITE_ACTIONS }
  }

  fun record(action: String) {
    taps[action] = SystemClock.elapsedRealtime()
  }

  /** Milliseconds since that button's last tap not yet taken, or `null`. Forgets it. */
  fun take(action: String): Long? {
    val at = taps.remove(action) ?: return null
    return SystemClock.elapsedRealtime() - at
  }
}
