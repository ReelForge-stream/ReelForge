# kotlinx.serialization keeps generated serializers
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class stream.reelforge.tv.**$$serializer { *; }
-keepclassmembers class stream.reelforge.tv.** { *** Companion; }
-keepclasseswithmembers class stream.reelforge.tv.** { kotlinx.serialization.KSerializer serializer(...); }
