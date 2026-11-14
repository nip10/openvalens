# OpenValens R8 rules (#522), appended to android/app/proguard-rules.pro at
# prebuild by plugins/android-r8. Every other native dependency either ships
# its own consumer rules (expo-modules-core, which also covers the local
# modules in modules/ and expo-quick-actions; react-native-health-connect;
# reanimated; worklets; svg; RxAndroidBle; Sentry's Android SDK) or is a plain
# React Native module, which react-android's rules keep (every NativeModule,
# @ReactProp setter, @DoNotStrip member and native method; Nitro modules such
# as react-native-quick-crypto are annotated @Keep/@DoNotStrip).

# Readable stack traces in Play Console (Android vitals) once the mapping file
# is applied: keep line numbers, but hide the original source file names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# expo-modules-core names its headless app loader only in a manifest
# meta-data string (org.unimodules.core.AppLoader#react-native-headless) and
# loads it with Class.forName, so R8 drops the class. Without it,
# expo-task-manager can't start JS for a background task while the app is
# closed: the background health sync (lib/health-sync/scheduler.ts) never runs.
-keep class * implements expo.modules.apploader.HeadlessAppLoader { <init>(); }

# react-native-ble-plx ships no consumer rules. Its bridge converts native
# BLE objects to JS by hand; Maestro can't reach it (no BLE on the emulator),
# so keep it whole rather than find a stripped path on a member's phone.
-keep class com.bleplx.** { *; }

# react-native-android-widget ships no consumer rules. The home-screen widget
# is drawn by a headless JS task in a separate broadcast, which the Maestro
# suite doesn't exercise.
-keep class com.reactnativeandroidwidget.** { *; }
