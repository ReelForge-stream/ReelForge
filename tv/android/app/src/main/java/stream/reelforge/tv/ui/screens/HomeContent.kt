package stream.reelforge.tv.ui.screens

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import stream.reelforge.tv.appState
import stream.reelforge.tv.data.Item
import stream.reelforge.tv.data.JellyfinApi
import kotlinx.coroutines.delay
import stream.reelforge.tv.ui.components.ContentRow
import stream.reelforge.tv.ui.components.Icons
import stream.reelforge.tv.ui.components.PrimaryButton
import stream.reelforge.tv.ui.components.SecondaryButton
import stream.reelforge.tv.ui.components.ItemOptions
import stream.reelforge.tv.ui.components.Meta
import stream.reelforge.tv.ui.components.Tag
import stream.reelforge.tv.ui.theme.RF

private data class HomeRow(val title: String, val items: List<Item>, val poster: Boolean = false)

private const val ROTATE_MS = 9_000L

/** Home: the focused title fills the top of the screen; rows of tiles below (Figma Home). */
@Composable
fun HomeContent(onOpen: (Item) -> Unit, onPlay: (Item) -> Unit) {
    val state = LocalContext.current.appState
    val api = state.api ?: return
    var rows by remember { mutableStateOf<List<HomeRow>?>(null) }
    var focused by remember { mutableStateOf<Item?>(null) }
    var options by remember { mutableStateOf<Item?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    // Featured titles rotate at the top while the highlight sits on the Play / More info buttons.
    var featured by remember { mutableStateOf<List<Item>>(emptyList()) }
    var at by remember { mutableIntStateOf(0) }
    var featuredMode by remember { mutableStateOf(true) }

    LaunchedEffect(reload) {
        rows = runCatching { loadHome(api, state.session?.userName.orEmpty()) }.getOrDefault(emptyList())
        featured = runCatching { featuredPool(api, rows.orEmpty()) }.getOrDefault(emptyList())
        if (focused == null) focused = rows?.firstOrNull()?.items?.firstOrNull()
    }
    LaunchedEffect(featuredMode, at, featured) {
        if (featuredMode && featured.size > 1) {
            delay(ROTATE_MS)
            at = (at + 1) % featured.size
        }
    }
    val spotlight = featured.getOrNull(at)

    Box(Modifier.fillMaxSize()) {
        Hero(if (featuredMode && spotlight != null) spotlight else focused, api)
        if (rows == null) {
            Text("Loading…", color = RF.Muted, modifier = Modifier.align(Alignment.Center))
        } else if (rows!!.isEmpty()) {
            Column(Modifier.align(Alignment.Center).width(560.dp)) {
                Text("Nothing here yet", style = MaterialTheme.typography.displaySmall, color = RF.Fg)
                Text("Add folders to a library in ReelForge on your computer (Server settings → Libraries) and titles appear here as they’re scanned.", color = RF.Muted, style = MaterialTheme.typography.bodyLarge)
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(top = 300.dp, bottom = 60.dp),
                verticalArrangement = Arrangement.spacedBy(28.dp),
            ) {
                if (spotlight != null) {
                    item(key = "featured") {
                        Row(
                            Modifier.padding(start = 48.dp).offset(y = (-24).dp),
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            val onFocus = Modifier.onFocusChanged { if (it.hasFocus) featuredMode = true }
                            PrimaryButton(if (spotlight.isSeries) "Watch" else "Play", Icons.Play, onFocus) { if (spotlight.isSeries) onOpen(spotlight) else onPlay(spotlight) }
                            SecondaryButton("More info", null, onFocus) { onOpen(spotlight) }
                            if (featured.size > 1) {
                                Row(Modifier.padding(start = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    featured.indices.forEach { i ->
                                        Box(Modifier.size(width = if (i == at) 22.dp else 8.dp, height = 4.dp).background(if (i == at) RF.Fg else RF.Fg.copy(alpha = 0.3f), RoundedCornerShape(2.dp)))
                                    }
                                }
                            }
                        }
                    }
                }
                rows!!.forEach { row ->
                    item(key = row.title) {
                        ContentRow(
                            title = row.title,
                            items = row.items,
                            imageFor = { api.image(it, if (row.poster) "Primary" else "Thumb", if (row.poster) 300 else 500) },
                            onOpen = { if (it.isEpisode) onPlay(it) else onOpen(it) },
                            onFocusItem = { focused = it; featuredMode = false },
                            onLongClick = { options = it },
                            poster = row.poster,
                        )
                    }
                }
            }
        }
        options?.let { o -> ItemOptions(o, { options = null }, onPlay, { onOpen(if (it.isEpisode && it.SeriesId != null) it.copy(Id = it.SeriesId, Type = "Series") else it) }, { reload++ }) }
    }
}

/** Up to 20 titles with big artwork: a few of the newest, then a shuffle of the rest of the library. */
private suspend fun featuredPool(api: JellyfinApi, rows: List<HomeRow>): List<Item> {
    val random = runCatching { api.items(types = "Movie,Series", sortBy = "Random", limit = 24, withImage = "Backdrop").Items }.getOrDefault(emptyList())
    val newest = rows.filter { it.title.startsWith("New in") }.flatMap { it.items.take(3) }.filter { !it.isEpisode && !it.BackdropImageTags.isNullOrEmpty() }
    return (newest + random.shuffled()).distinctBy { it.Id }.take(20)
}

private suspend fun loadHome(api: JellyfinApi, name: String): List<HomeRow> {
    val views = api.views()
    val resume = runCatching { api.resume() }.getOrDefault(emptyList())
    val next = runCatching { api.nextUp() }.getOrDefault(emptyList())
    val list = runCatching { api.items(types = "Movie,Series", favorites = true, sortBy = "DateCreated,SortName", sortOrder = "Descending", limit = 30).Items }.getOrDefault(emptyList())
    val libs = views.filter { it.CollectionType == "movies" || it.CollectionType == "tvshows" }
    return buildList {
        if (resume.isNotEmpty()) add(HomeRow("Continue Watching for $name", resume))
        if (next.isNotEmpty()) add(HomeRow("Next Episodes", next))
        for (l in libs) {
            val latest = runCatching { api.latest(l.Id) }.getOrDefault(emptyList())
            if (latest.isNotEmpty()) add(HomeRow("New in ${l.Name}", latest))
        }
        if (list.isNotEmpty()) add(HomeRow("My List", list))
        for (l in libs.filter { it.CollectionType == "movies" }) {
            val top = runCatching { api.items(parentId = l.Id, types = "Movie", sortBy = "CommunityRating,SortName", sortOrder = "Descending", limit = 10).Items }.getOrDefault(emptyList())
            if (top.size >= 5) add(HomeRow("Top Rated in ${l.Name}", top, poster = true))
        }
    }
}

/** The big picture at the top: background art, logo (or title), facts and summary of the focused title. */
@Composable
fun Hero(item: Item?, api: JellyfinApi) {
    Box(Modifier.fillMaxWidth().fillMaxHeight(0.62f)) {
        Crossfade(item?.Id, label = "hero") { _ ->
            val it = item ?: return@Crossfade
            Box(Modifier.fillMaxSize()) {
                val bg = api.image(it, "Backdrop", 1280) ?: api.image(it, "Thumb", 1280)
                if (bg != null) {
                    AsyncImage(bg, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxHeight().fillMaxWidth(0.72f).align(Alignment.TopEnd))
                }
                Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0.25f to RF.Base, 0.6f to RF.Base.copy(alpha = 0.55f), 1f to Color.Transparent)))
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.5f to Color.Transparent, 1f to RF.Base)))
                Column(Modifier.padding(start = 48.dp, top = 40.dp).width(520.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    val logo = api.image(it, "Logo", 600)
                    val title = if (it.isEpisode) it.SeriesName ?: it.Name else it.Name
                    if (logo != null) {
                        AsyncImage(logo, title, contentScale = ContentScale.Fit, alignment = Alignment.CenterStart, modifier = Modifier.heightIn(max = 96.dp).width(360.dp))
                    } else {
                        Text(title, style = MaterialTheme.typography.displayMedium, color = RF.Fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    if (it.isEpisode) Text("${it.episodeCode} · ${it.Name}", style = MaterialTheme.typography.titleLarge, color = RF.Fg)
                    Meta(
                        listOfNotNull(
                            it.ProductionYear?.toString(),
                            it.runtimeMinutes?.let { m -> if (m >= 60) "${m / 60}h ${m % 60}m" else "${m}m" },
                            it.CommunityRating?.let { r -> "★ %.1f".format(r) },
                        ),
                    )
                    it.OfficialRating?.let { r -> Tag(r) }
                    it.Overview?.let { o -> Text(o, style = MaterialTheme.typography.bodyLarge, color = RF.Fg.copy(alpha = 0.85f), maxLines = 3, overflow = TextOverflow.Ellipsis) }
                }
            }
        }
    }
    Spacer(Modifier.height(0.dp))
}
