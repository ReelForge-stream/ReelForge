package stream.reelforge.tv.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import stream.reelforge.tv.appState
import stream.reelforge.tv.data.Item
import stream.reelforge.tv.ui.components.ContentRow
import stream.reelforge.tv.ui.components.Icons
import stream.reelforge.tv.ui.components.Meta
import stream.reelforge.tv.ui.components.PrimaryButton
import stream.reelforge.tv.ui.components.SecondaryButton
import stream.reelforge.tv.ui.components.Tag
import stream.reelforge.tv.ui.components.WideCard
import stream.reelforge.tv.ui.theme.RF

/** A movie or show: art, facts, Play / Resume / My List / Watched, seasons and episodes, more like this. */
@Composable
fun DetailsScreen(id: String, onPlay: (Item, Boolean) -> Unit, onOpen: (Item) -> Unit) {
    val state = LocalContext.current.appState
    val api = state.api ?: return
    val scope = rememberCoroutineScope()
    var item by remember { mutableStateOf<Item?>(null) }
    var seasons by remember { mutableStateOf<List<Item>>(emptyList()) }
    var season by remember { mutableStateOf<Item?>(null) }
    var episodes by remember { mutableStateOf<List<Item>>(emptyList()) }
    var similar by remember { mutableStateOf<List<Item>>(emptyList()) }
    var reload by remember { mutableIntStateOf(0) }
    val playFocus = remember { FocusRequester() }

    LaunchedEffect(id, reload) {
        val it = runCatching { api.item(id) }.getOrNull() ?: return@LaunchedEffect
        item = it
        if (it.isSeries) {
            seasons = runCatching { api.seasons(id) }.getOrDefault(emptyList())
            if (season == null) season = seasons.firstOrNull { s -> (s.UserData?.UnplayedItemCount ?: 0) > 0 } ?: seasons.firstOrNull()
        }
        similar = runCatching { api.similar(id) }.getOrDefault(emptyList())
        if (reload == 0) runCatching { playFocus.requestFocus() }
    }
    LaunchedEffect(season?.Id, reload) {
        val s = season ?: return@LaunchedEffect
        episodes = runCatching { api.episodes(id, s.Id) }.getOrDefault(emptyList())
    }

    val it = item
    Box(Modifier.fillMaxSize().background(RF.Base)) {
        if (it == null) {
            Text("Loading…", color = RF.Muted, modifier = Modifier.align(Alignment.Center))
            return@Box
        }
        api.image(it, "Backdrop", 1920)?.let { bg ->
            AsyncImage(bg, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth(0.75f).fillMaxHeight(0.8f).align(Alignment.TopEnd))
        }
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0.3f to RF.Base, 0.65f to RF.Base.copy(alpha = 0.5f), 1f to Color.Transparent)))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 0.8f to RF.Base)))

        val nextEp = episodes.firstOrNull { e -> e.UserData?.Played != true }
        val resumable = if (it.isSeries) (nextEp?.UserData?.PlayedPercentage ?: 0.0) > 0 else (it.UserData?.PlayedPercentage ?: 0.0) > 0
        val fav = it.UserData?.IsFavorite == true
        val played = it.UserData?.Played == true

        LazyColumn(contentPadding = PaddingValues(top = 56.dp, bottom = 56.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
            item {
                Column(Modifier.padding(start = 56.dp).width(620.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    val logo = api.image(it, "Logo", 700)
                    if (logo != null) AsyncImage(logo, it.Name, contentScale = ContentScale.Fit, alignment = Alignment.CenterStart, modifier = Modifier.heightIn(max = 120.dp).width(420.dp))
                    else Text(it.Name, style = MaterialTheme.typography.displayLarge, color = RF.Fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Meta(
                        listOfNotNull(
                            it.ProductionYear?.toString(),
                            if (it.isSeries) seasons.size.takeIf { n -> n > 0 }?.let { n -> if (n == 1) "1 Season" else "$n Seasons" } else it.runtimeMinutes?.let { m -> if (m >= 60) "${m / 60}h ${m % 60}m" else "${m}m" },
                            it.CommunityRating?.let { r -> "★ %.1f".format(r) },
                        ),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        it.OfficialRating?.let { r -> Tag(r) }
                        it.Genres?.take(3)?.let { g -> Text(g.joinToString(" · "), color = RF.Muted, style = MaterialTheme.typography.bodyMedium) }
                    }
                    it.Taglines?.firstOrNull()?.let { t -> Text(t, style = MaterialTheme.typography.titleMedium, color = RF.Fg) }
                    it.Overview?.let { o -> Text(o, style = MaterialTheme.typography.bodyLarge, color = RF.Fg.copy(alpha = 0.88f), maxLines = 4, overflow = TextOverflow.Ellipsis) }
                    val cast = it.People?.filter { p -> p.Type == "Actor" }?.take(4)?.joinToString(", ") { p -> p.Name }
                    if (!cast.isNullOrBlank()) Text("Cast: $cast", style = MaterialTheme.typography.bodyMedium, color = RF.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        val target = if (it.isSeries) nextEp ?: episodes.firstOrNull() else it
                        PrimaryButton(
                            when {
                                it.isSeries && target != null -> "${if (resumable) "Resume" else "Play"} ${target.episodeCode}"
                                resumable -> "Resume"
                                else -> "Play"
                            },
                            Icons.Play,
                            Modifier.focusRequester(playFocus),
                            enabled = target != null,
                        ) { target?.let { t -> onPlay(t, false) } }
                        if (resumable && !it.isSeries) SecondaryButton("From the beginning", Icons.Restart) { onPlay(it, true) }
                        SecondaryButton(if (fav) "In My List" else "My List", if (fav) Icons.Check else Icons.Plus) {
                            scope.launch { runCatching { api.setFavorite(it.Id, !fav) }; reload++ }
                        }
                        if (!it.isSeries) SecondaryButton(if (played) "Watched" else "Mark watched", Icons.Check) {
                            scope.launch { runCatching { api.setPlayed(it.Id, !played) }; reload++ }
                        }
                    }
                }
            }
            if (it.isSeries && seasons.isNotEmpty()) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        LazyRow(contentPadding = PaddingValues(horizontal = 56.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(seasons, key = { s -> s.Id }) { s ->
                                val on = s.Id == season?.Id
                                Surface(
                                    onClick = { season = s },
                                    shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(18.dp)),
                                    colors = ClickableSurfaceDefaults.colors(
                                        containerColor = if (on) RF.Fg else RF.Surface,
                                        contentColor = if (on) RF.Base else RF.Fg,
                                        focusedContainerColor = RF.Ember,
                                        focusedContentColor = RF.EmberInk,
                                    ),
                                ) { Text(s.Name, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
                            }
                        }
                        LazyRow(contentPadding = PaddingValues(horizontal = 56.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                            items(episodes, key = { e -> e.Id }) { e ->
                                Column(Modifier.width(280.dp)) {
                                    WideCard(e.copy(SeriesName = "${e.IndexNumber}. ${e.Name}"), api.image(e, "Thumb", 560), 280.dp, onClick = { onPlay(e, false) })
                                    e.Overview?.let { o -> Text(o, style = MaterialTheme.typography.bodySmall, color = RF.Muted, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp)) }
                                }
                            }
                        }
                    }
                }
            }
            if (similar.isNotEmpty()) {
                item {
                    ContentRow("More Like This", similar, { s -> api.image(s, "Thumb", 500) }, onOpen = onOpen, onFocusItem = {})
                }
            }
        }
    }
}
