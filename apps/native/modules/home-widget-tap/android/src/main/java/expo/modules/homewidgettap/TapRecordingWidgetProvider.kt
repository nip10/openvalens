package expo.modules.homewidgettap

import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import com.reactnativeandroidwidget.RNWidgetProvider

/**
 * The home-screen widget's receiver (#449, #505). It is the widget library's
 * own, with one addition: when a water or "Taken" button opens the app, the
 * tap is recorded first (`HomeWidgetTaps`). The receiver is not exported, so
 * only the system and the widget's own PendingIntents reach it.
 *
 * The app's widget class (`com.openvalens.app.widget.QuickLog`, which the
 * library generates at prebuild) extends this one; `plugins/home-widget`
 * rewrites it. The class name stays, so widgets already on a home screen keep
 * working.
 */
open class TapRecordingWidgetProvider : RNWidgetProvider() {
  override fun onReceive(context: Context, incomingIntent: Intent) {
    val action = HomeWidgetTaps.writeActionOf(context, incomingIntent)
    if (action == null) {
      super.onReceive(context, incomingIntent)
      return
    }
    // The library may swallow a tap (while it corrects the widget's size), so
    // the tap counts only once the library actually opens the app.
    super.onReceive(
      object : ContextWrapper(context) {
        override fun startActivity(intent: Intent) {
          HomeWidgetTaps.record(action)
          super.startActivity(intent)
        }
      },
      incomingIntent,
    )
  }
}
