# PayByCard ProGuard Rules

# Keep React Native classes
-keep class com.facebook.react.** { *; }
-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.react.modules.** { *; }
-keep class com.facebook.react.uimanager.** { *; }
-keep class com.facebook.react.views.** { *; }
-keep class * implements com.facebook.react.bridge.NativeModule { *; }
-keep class * implements com.facebook.react.bridge.JavaScriptModule { *; }
-keep class * implements com.facebook.react.bridge.UIManager { *; }
-keep class * implements com.facebook.react.bridge.ViewManager { *; }
-keep @com.facebook.react.module.annotations.ReactModule class *
-keep @com.facebook.react.uimanager.annotations.ReactProp class *

# Keep Expo modules
-keep class expo.modules.** { *; }
-keep class * implements expo.modules.kotlin.modules.AppModule { *; }
-keep class * implements expo.modules.kotlin.modules.Module { *; }

# Keep application classes
-keep class in.paybycard.app.** { *; }

# Keep model classes (used by Material components)
-keep class com.google.android.material.** { *; }
-dontwarn com.google.android.material.**

# Keep Supabase
-keep class io.supabase.** { *; }

# Keep OkHttp (used by network libraries)
-dontwarn okhttp3.**
-dontwarn okio.**

# Keep Kotlin metadata
-keep class kotlin.Metadata { *; }

# Optimization (R8-compatible — mergeinterfacesaggressively and optimizationpasses are deprecated in R8 full mode)
-allowaccessmodification

# Remove logging
-assumenosideeffects class android.util.Log {
    public static *** v(...);
    public static *** d(...);
    public static *** i(...);
    public static *** w(...);
    public static *** e(...);
}
