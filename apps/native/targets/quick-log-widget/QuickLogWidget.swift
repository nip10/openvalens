import SwiftUI
import WidgetKit

// The iOS home-screen widget (#449): water +1 glass, "Taken" for the next
// supplement that is due, and "Log…". Each button opens the app through a deep
// link (`openvalens://quick-log?widget=<action>`, the same links as
// lib/home-widget/model.ts); the app saves at once with the member's own
// session and offline queue, and offers Undo. The widget is static and holds
// no data: there is no App Group, so the app cannot give it any. Its labels
// come from Localizable.strings, generated from the Lingui catalogs.

@main
struct QuickLogWidgetBundle: WidgetBundle {
  var body: some Widget {
    QuickLogWidget()
  }
}

struct QuickLogEntry: TimelineEntry {
  let date: Date
}

struct QuickLogProvider: TimelineProvider {
  func placeholder(in context: Context) -> QuickLogEntry {
    QuickLogEntry(date: Date())
  }

  func getSnapshot(in context: Context, completion: @escaping (QuickLogEntry) -> Void) {
    completion(QuickLogEntry(date: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<QuickLogEntry>) -> Void) {
    // Nothing on it changes, so it never needs redrawing.
    completion(Timeline(entries: [QuickLogEntry(date: Date())], policy: .never))
  }
}

struct QuickLogButton: Identifiable {
  let id: String
  let label: LocalizedStringKey
  let detail: LocalizedStringKey
  let symbol: String
  let tone: Color

  var url: URL { URL(string: "openvalens://quick-log?widget=\(id)")! }
}

private let buttons = [
  QuickLogButton(
    id: "water", label: "water", detail: "water_action", symbol: "drop", tone: Color("water")),
  QuickLogButton(
    id: "supplement", label: "supplement", detail: "supplement_action", symbol: "pills",
    tone: Color("supplement")),
  QuickLogButton(id: "log", label: "log", detail: "log_action", symbol: "plus", tone: Color("log")),
]

struct QuickLogWidgetView: View {
  var body: some View {
    HStack(spacing: 8) {
      ForEach(buttons) { button in
        Link(destination: button.url) {
          VStack(alignment: .leading, spacing: 4) {
            Image(systemName: button.symbol)
              .font(.system(size: 20, weight: .semibold))
              .foregroundStyle(button.tone)
              .accessibilityHidden(true)
            Spacer(minLength: 0)
            Text(button.label)
              .font(.system(size: 15, weight: .semibold))
              .foregroundStyle(Color("ink"))
              .lineLimit(1)
              .minimumScaleFactor(0.8)
            Text(button.detail)
              .font(.system(size: 13))
              .foregroundStyle(Color("muted"))
              .lineLimit(1)
              .minimumScaleFactor(0.8)
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
          .padding(12)
          .background(Color("tile"), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
          .accessibilityElement(children: .combine)
          .accessibilityAddTraits(.isButton)
        }
      }
    }
    .containerBackground(for: .widget) {
      Color("$widgetBackground")
    }
  }
}

struct QuickLogWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "QuickLogWidget", provider: QuickLogProvider()) { _ in
      QuickLogWidgetView()
    }
    .configurationDisplayName("widget_name")
    .description("widget_description")
    // Home screen only: no lock-screen (accessory) families.
    .supportedFamilies([.systemMedium])
  }
}
