package expo.modules.homewidgettap

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Lets the quick-log screen take a recorded widget tap (`HomeWidgetTaps`, #505). */
class HomeWidgetTapModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HomeWidgetTap")

    /** Milliseconds since the button's last tap not yet taken, or `null`. Forgets it. */
    Function("takeTap") { action: String ->
      HomeWidgetTaps.take(action)?.toDouble()
    }
  }
}
