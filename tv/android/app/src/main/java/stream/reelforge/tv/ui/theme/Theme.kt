package stream.reelforge.tv.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Typography
import androidx.tv.material3.darkColorScheme
import stream.reelforge.tv.R

/** ReelForge brand: steel surfaces, one molten accent. */
object RF {
    val Base = Color(0xFF17202A)
    val Deep = Color(0xFF121922)
    val Surface = Color(0xFF212C38)
    val Surface2 = Color(0xFF2B3846)
    val Fg = Color(0xFFE8EDF2)
    val Muted = Color(0xFF93A4B5)
    val Ember = Color(0xFFFF8A1F)
    val EmberInk = Color(0xFF17202A)
    val Coolant = Color(0xFF5FD3A6)
    val Danger = Color(0xFFFF6B6B)
}

val Display = FontFamily(
    Font(R.font.chakra_medium, FontWeight.Medium),
    Font(R.font.chakra_semibold, FontWeight.SemiBold),
    Font(R.font.chakra_bold, FontWeight.Bold),
)

private val type = Typography(
    displayLarge = TextStyle(fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 52.sp, lineHeight = 54.sp),
    displayMedium = TextStyle(fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 40.sp, lineHeight = 44.sp),
    displaySmall = TextStyle(fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 32.sp, lineHeight = 36.sp),
    headlineMedium = TextStyle(fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 26.sp),
    headlineSmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 20.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 18.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp),
    titleSmall = TextStyle(fontWeight = FontWeight.Medium, fontSize = 14.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
    labelMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 13.sp),
    labelSmall = TextStyle(fontWeight = FontWeight.Bold, fontSize = 10.sp),
)

@Composable
fun ReelForgeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = RF.Ember,
            onPrimary = RF.EmberInk,
            secondary = RF.Coolant,
            background = RF.Base,
            onBackground = RF.Fg,
            surface = RF.Surface,
            onSurface = RF.Fg,
            surfaceVariant = RF.Surface2,
            onSurfaceVariant = RF.Muted,
            border = RF.Muted,
            error = RF.Danger,
            inverseSurface = RF.Fg,
            inverseOnSurface = RF.Base,
        ),
        typography = type,
        content = content,
    )
}
