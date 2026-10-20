package stream.reelforge.tv.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Border
import androidx.tv.material3.Card
import androidx.tv.material3.CardDefaults
import androidx.tv.material3.Icon
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import stream.reelforge.tv.data.Item
import stream.reelforge.tv.ui.theme.Display
import stream.reelforge.tv.ui.theme.RF
import kotlin.math.absoluteValue

/** A picture from the server, or a generated title card in the house style when there isn't one. */
@Composable
fun Art(url: String?, title: String, modifier: Modifier = Modifier, showTitle: Boolean = true, sub: String? = null) {
    Box(modifier.background(RF.Surface)) {
        val hue = (title.hashCode().absoluteValue % 360).toFloat()
        if (url == null) {
            Box(
                Modifier.fillMaxSize().background(
                    Brush.linearGradient(listOf(Color.hsv(hue, 0.5f, 0.42f), Color.hsv((hue + 30) % 360, 0.45f, 0.14f))),
                ),
            )
            if (showTitle) {
                Column(Modifier.align(Alignment.BottomStart).padding(10.dp)) {
                    Text(title, style = MaterialTheme.typography.titleMedium.copy(fontFamily = Display), color = RF.Fg, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    if (sub != null) Text(sub, style = MaterialTheme.typography.bodySmall, color = RF.Fg.copy(alpha = 0.75f), maxLines = 1)
                }
            }
        } else {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
}

private val cardShape = RoundedCornerShape(6.dp)

@Composable
private fun cardBorder() = CardDefaults.border(
    focusedBorder = Border(androidx.compose.foundation.BorderStroke(3.dp, RF.Fg), shape = cardShape),
)

/** 16:9 tile: thumbnail, title under it, progress bar for things in progress. */
@Composable
fun WideCard(item: Item, imageUrl: String?, width: Dp, onClick: () -> Unit, onFocus: () -> Unit = {}, onLongClick: (() -> Unit)? = null, label: String? = null) {
    Column(Modifier.width(width)) {
        Card(
            onClick = onClick,
            onLongClick = onLongClick,
            modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f).onFocusChanged { if (it.isFocused) onFocus() },
            shape = CardDefaults.shape(cardShape),
            border = cardBorder(),
            scale = CardDefaults.scale(focusedScale = 1.06f),
            glow = CardDefaults.glow(),
        ) {
            Box(Modifier.fillMaxSize()) {
                Art(imageUrl, item.SeriesName?.takeIf { item.isEpisode } ?: item.Name, Modifier.fillMaxSize(), sub = if (item.isEpisode) "${item.episodeCode} · ${item.Name}" else null)
                if (item.UserData?.Played == true) Watched(Modifier.align(Alignment.TopEnd).padding(6.dp))
                val pct = item.UserData?.PlayedPercentage
                if (pct != null && pct > 0) {
                    Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(4.dp).background(Color.Black.copy(alpha = 0.45f))) {
                        Box(Modifier.fillMaxWidth((pct / 100).toFloat().coerceIn(0f, 1f)).fillMaxSize().background(RF.Ember))
                    }
                }
                if (label != null) {
                    Text(
                        label,
                        style = MaterialTheme.typography.labelSmall,
                        color = RF.EmberInk,
                        modifier = Modifier.align(Alignment.BottomCenter).background(RF.Ember, RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(
            if (item.isEpisode) item.SeriesName ?: item.Name else item.Name,
            style = MaterialTheme.typography.titleSmall,
            color = RF.Fg,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            if (item.isEpisode) "${item.episodeCode} · ${item.Name}" else listOfNotNull(item.ProductionYear?.toString(), if (item.isSeries) "TV show" else null).joinToString(" · "),
            style = MaterialTheme.typography.bodySmall,
            color = RF.Muted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** 2:3 poster for grids. */
@Composable
fun PosterCard(item: Item, imageUrl: String?, width: Dp, onClick: () -> Unit, onFocus: () -> Unit = {}, onLongClick: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    Column(modifier.width(width)) {
        Card(
            onClick = onClick,
            onLongClick = onLongClick,
            modifier = Modifier.fillMaxWidth().aspectRatio(2f / 3f).onFocusChanged { if (it.isFocused) onFocus() },
            shape = CardDefaults.shape(cardShape),
            border = cardBorder(),
            scale = CardDefaults.scale(focusedScale = 1.06f),
        ) {
            Box(Modifier.fillMaxSize()) {
                Art(imageUrl, item.Name, Modifier.fillMaxSize(), sub = item.ProductionYear?.toString())
                if (item.UserData?.Played == true) Watched(Modifier.align(Alignment.TopEnd).padding(6.dp))
                val unplayed = item.UserData?.UnplayedItemCount
                if (item.isSeries && unplayed != null && unplayed > 0) {
                    Text(
                        "$unplayed",
                        style = MaterialTheme.typography.labelMedium,
                        color = RF.EmberInk,
                        modifier = Modifier.align(Alignment.TopEnd).padding(6.dp).background(RF.Ember, RoundedCornerShape(10.dp)).padding(horizontal = 7.dp, vertical = 1.dp),
                    )
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(item.Name, style = MaterialTheme.typography.titleSmall, color = RF.Fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun Watched(modifier: Modifier) {
    Box(modifier.size(22.dp).background(RF.Deep.copy(alpha = 0.85f), CircleShape), contentAlignment = Alignment.Center) {
        Icon(Icons.Check, null, tint = RF.Coolant, modifier = Modifier.size(14.dp))
    }
}

/** A titled, horizontally scrolling row of tiles. */
@Composable
fun ContentRow(
    title: String,
    items: List<Item>,
    imageFor: (Item) -> String?,
    onOpen: (Item) -> Unit,
    onFocusItem: (Item) -> Unit,
    onLongClick: ((Item) -> Unit)? = null,
    labelFor: (Item) -> String? = { null },
    poster: Boolean = false,
) {
    Column(Modifier.fillMaxWidth()) {
        Text(title, style = MaterialTheme.typography.titleLarge, color = Color(0xFFDDE3E9), modifier = Modifier.padding(start = 48.dp, bottom = 12.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 48.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            items(items, key = { it.Id }) { item ->
                if (poster) {
                    PosterCard(item, imageFor(item), 140.dp, onClick = { onOpen(item) }, onFocus = { onFocusItem(item) }, onLongClick = onLongClick?.let { { it(item) } })
                } else {
                    WideCard(item, imageFor(item), 248.dp, onClick = { onOpen(item) }, onFocus = { onFocusItem(item) }, onLongClick = onLongClick?.let { { it(item) } }, label = labelFor(item))
                }
            }
        }
    }
}

/** Small rating / quality box like on the web app. */
@Composable
fun Tag(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.labelMedium, color = RF.Fg, modifier = modifier.border(1.dp, RF.Fg.copy(alpha = 0.4f), RoundedCornerShape(3.dp)).padding(horizontal = 6.dp, vertical = 1.dp))
}

@Composable
fun Meta(parts: List<String>, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        parts.forEach { Text(it, style = MaterialTheme.typography.bodyLarge, color = Color(0xFFC3CDD6)) }
    }
}

fun Modifier.roundedClip(r: Dp) = this.clip(RoundedCornerShape(r))
