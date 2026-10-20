package stream.reelforge.tv.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import kotlinx.coroutines.launch
import stream.reelforge.tv.appState
import stream.reelforge.tv.data.Item
import stream.reelforge.tv.ui.components.ItemOptions
import stream.reelforge.tv.ui.components.PosterCard
import stream.reelforge.tv.ui.theme.RF

private val SORTS = listOf(
    Triple("SortName", "Ascending", "A–Z"),
    Triple("DateCreated,SortName", "Descending", "Recently added"),
    Triple("ProductionYear,SortName", "Descending", "Newest"),
    Triple("CommunityRating,SortName", "Descending", "Top rated"),
)
private val LETTERS = listOf("#") + ('A'..'Z').map { it.toString() }

fun letterOf(item: Item): String {
    val c = (item.SortName ?: item.Name).trim().firstOrNull()?.uppercaseChar() ?: '#'
    return if (c in 'A'..'Z') c.toString() else "#"
}

/** A whole library as a poster grid, with an A–Z column on the right to jump around (like Plex). */
@Composable
fun LibraryContent(id: String, name: String, type: String?, onOpen: (Item) -> Unit, onPlay: (Item) -> Unit) {
    val state = LocalContext.current.appState
    val api = state.api ?: return
    val scope = rememberCoroutineScope()
    var sort by remember(id) { mutableIntStateOf(0) }
    var items by remember(id) { mutableStateOf<List<Item>?>(null) }
    var options by remember { mutableStateOf<Item?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    val grid = remember(id, sort) { LazyGridState() } // a fresh list starts at the top
    val types = when (type) { "tvshows" -> "Series"; "movies" -> "Movie"; else -> "Movie,Series,Video" }

    LaunchedEffect(id, sort, reload) {
        val (by, order) = SORTS[sort]
        items = runCatching { api.items(parentId = id, types = types, sortBy = by, sortOrder = order, limit = 100_000).Items }.getOrDefault(emptyList())
    }
    val az = sort == 0
    val firstOf by remember(items) { derivedStateOf { items.orEmpty().withIndex().groupBy({ letterOf(it.value) }, { it.index }).mapValues { it.value.first() } } }
    val current by remember { derivedStateOf { items?.getOrNull(grid.firstVisibleItemIndex)?.let(::letterOf) } }

    Row(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).fillMaxHeight()) {
            Row(Modifier.padding(start = 48.dp, top = 28.dp, end = 24.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(name, style = MaterialTheme.typography.displaySmall, color = RF.Fg, modifier = Modifier.padding(end = 20.dp))
                SORTS.forEachIndexed { i, s ->
                    if (i == sort) SortChip(s.third, true) { } else SortChip(s.third, false) { sort = i }
                }
                items?.let { Text("${it.size} ${if (type == "tvshows") "shows" else "titles"}", color = RF.Muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 12.dp)) }
            }
            if (items == null) Text("Loading…", color = RF.Muted, modifier = Modifier.padding(48.dp))
            LazyVerticalGrid(
                columns = GridCells.Adaptive(132.dp),
                state = grid,
                contentPadding = PaddingValues(start = 48.dp, end = 16.dp, top = 16.dp, bottom = 48.dp),
                horizontalArrangement = Arrangement.spacedBy(20.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                itemsIndexed(items.orEmpty(), key = { _, it -> it.Id }) { _, item ->
                    PosterCard(item, api.image(item, "Primary", 300), 132.dp, onClick = { onOpen(item) }, onLongClick = { options = item })
                }
            }
        }
        if (!items.isNullOrEmpty()) {
            // A–Z: pick a letter to jump there (switches to A–Z order first).
            Column(Modifier.fillMaxHeight().padding(vertical = 24.dp, horizontal = 6.dp), verticalArrangement = Arrangement.SpaceEvenly) {
                LETTERS.forEach { l ->
                    val has = !az || l in firstOf
                    Surface(
                        onClick = {
                            if (!az) sort = 0
                            scope.launch {
                                if (az) firstOf[l]?.let { grid.scrollToItem(it) }
                            }
                        },
                        enabled = has,
                        modifier = Modifier.size(width = 26.dp, height = 18.dp),
                        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(4.dp)),
                        colors = ClickableSurfaceDefaults.colors(
                            containerColor = if (az && current == l) RF.Ember else androidx.compose.ui.graphics.Color.Transparent,
                            contentColor = if (az && current == l) RF.EmberInk else if (has) RF.Fg else RF.Muted.copy(alpha = 0.35f),
                            focusedContainerColor = RF.Fg,
                            focusedContentColor = RF.Base,
                            disabledContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                            disabledContentColor = RF.Muted.copy(alpha = 0.3f),
                        ),
                        scale = ClickableSurfaceDefaults.scale(focusedScale = 1.25f),
                    ) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(l, style = MaterialTheme.typography.labelMedium) }
                    }
                }
            }
        }
    }
    options?.let { o -> ItemOptions(o, { options = null }, onPlay, onOpen) { reload++ } }
}

@Composable
private fun SortChip(label: String, on: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = ClickableSurfaceDefaults.shape(RoundedCornerShape(18.dp)),
        colors = ClickableSurfaceDefaults.colors(
            containerColor = if (on) RF.Fg else RF.Surface,
            contentColor = if (on) RF.Base else RF.Fg,
            focusedContainerColor = RF.Ember,
            focusedContentColor = RF.EmberInk,
        ),
    ) { Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 16.dp, vertical = 7.dp)) }
}

/** My List: everything marked with + (shared with the web app). */
@Composable
fun MyListContent(onOpen: (Item) -> Unit, onPlay: (Item) -> Unit) {
    val state = LocalContext.current.appState
    val api = state.api ?: return
    var items by remember { mutableStateOf<List<Item>?>(null) }
    var options by remember { mutableStateOf<Item?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) {
        items = runCatching { api.items(types = "Movie,Series,Episode", favorites = true, sortBy = "DateCreated,SortName", sortOrder = "Descending", limit = 500).Items }.getOrDefault(emptyList())
    }
    Column(Modifier.fillMaxSize()) {
        Text("My List", style = MaterialTheme.typography.displaySmall, color = RF.Fg, modifier = Modifier.padding(start = 48.dp, top = 28.dp, bottom = 8.dp))
        if (items?.isEmpty() == true) {
            Text("Your list is empty. Open any title and choose “My List”, or hold OK on a tile.", color = RF.Muted, modifier = Modifier.padding(horizontal = 48.dp, vertical = 12.dp), style = MaterialTheme.typography.bodyLarge)
        }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(132.dp),
            contentPadding = PaddingValues(start = 48.dp, end = 48.dp, top = 16.dp, bottom = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(20.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            itemsIndexed(items.orEmpty(), key = { _, it -> it.Id }) { _, item ->
                PosterCard(item, api.image(item, "Primary", 300), 132.dp, onClick = { if (item.isEpisode) onPlay(item) else onOpen(item) }, onLongClick = { options = item })
            }
        }
    }
    options?.let { o -> ItemOptions(o, { options = null }, onPlay, onOpen) { reload++ } }
}

