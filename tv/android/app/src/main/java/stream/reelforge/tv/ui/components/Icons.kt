package stream.reelforge.tv.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/** The same line icons as the web app, drawn from their SVG paths. */
object Icons {
    private fun icon(name: String, vararg paths: String, filled: Boolean = false): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
            for (d in paths) {
                addPath(
                    pathData = PathParser().parsePathString(d).toNodes(),
                    fill = if (filled) SolidColor(Color.White) else null,
                    stroke = if (filled) null else SolidColor(Color.White),
                    strokeLineWidth = if (filled) 0f else 1.9f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()

    val Play = icon("play", "M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z", filled = true)
    val Home = icon("home", "M4 11.5 12 5l8 6.5V20H14v-5h-4v5H4z")
    val Film = icon("film", "M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z", "M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4")
    val Tv = icon("tv", "M5 6h14a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z", "M9 3l3 3 3-3")
    val Search = icon("search", "M11 4.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13z", "m20 20-4.2-4.2")
    val Heart = icon("heart", "M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z")
    val Settings = icon(
        "settings",
        "M10.3 3.5h3.4l.5 2.4 1.7 1 2.3-.8 1.7 2.9-1.8 1.6v2l1.8 1.6-1.7 2.9-2.3-.8-1.7 1-.5 2.4h-3.4l-.5-2.4-1.7-1-2.3.8-1.7-2.9 1.8-1.6v-2L3.9 9l1.7-2.9 2.3.8 1.7-1z",
        "M12 9.2a2.8 2.8 0 1 1 0 5.6a2.8 2.8 0 1 1 0-5.6z",
    )
    val Plus = icon("plus", "M12 5v14M5 12h14")
    val Check = icon("check", "m5 12.5 4.5 4.5L19 7.5")
    val Restart = icon("restart", "M4.5 12a7.5 7.5 0 1 0 2.2-5.3", "M4.5 3.5v4h4")
    val Folder = icon("folder", "M5.5 5.5h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2z")
    val User = icon("user", "M12 4.7a3.8 3.8 0 1 1 0 7.6a3.8 3.8 0 1 1 0-7.6z", "M4.5 20a7.5 7.5 0 0 1 15 0")
}
