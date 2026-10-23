package stream.reelforge.tv.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import stream.reelforge.tv.appState
import stream.reelforge.tv.data.Item
import stream.reelforge.tv.ui.components.ContentRow
import stream.reelforge.tv.ui.theme.RF

/** An actor: photo, a little about them, and every movie and show they're in on this server. */
@Composable
fun PersonScreen(id: String, onOpen: (Item) -> Unit) {
    val api = LocalContext.current.appState.api ?: return
    var person by remember { mutableStateOf<Item?>(null) }
    var titles by remember { mutableStateOf<List<Item>?>(null) }
    LaunchedEffect(id) {
        person = runCatching { api.item(id) }.getOrNull()
        titles = runCatching { api.appearances(id) }.getOrDefault(emptyList())
    }
    val all = titles.orEmpty()
    val movies = all.filter { it.Type == "Movie" }
    // Shows they're main cast in, plus shows they guest in (from their episodes).
    val shows = (all.filter { it.isSeries } + all.filter { it.isEpisode && it.SeriesId != null }.map { e ->
        Item(Id = e.SeriesId!!, Name = e.SeriesName ?: e.Name, Type = "Series", ImageTags = e.SeriesPrimaryImageTag?.let { mapOf("Primary" to it) })
    }).distinctBy { it.Id }

    LazyColumn(Modifier.fillMaxSize().background(RF.Base), contentPadding = PaddingValues(top = 48.dp, bottom = 48.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
        item {
            Row(Modifier.padding(horizontal = 56.dp), horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                Box(Modifier.width(180.dp).height(270.dp).background(RF.Surface, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                    val img = person?.let { p -> api.image(p, "Primary", 360) }
                    if (img != null) AsyncImage(img, person?.Name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                    else Text(person?.Name?.take(1).orEmpty(), style = MaterialTheme.typography.displayMedium, color = RF.Muted)
                }
                Column(Modifier.width(760.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(person?.Name ?: "", style = MaterialTheme.typography.displayMedium, color = RF.Fg)
                    person?.PremiereDate?.take(4)?.let { y ->
                        Text("Born $y" + (person?.ProductionLocations?.firstOrNull()?.let { " in $it" } ?: ""), color = RF.Muted, style = MaterialTheme.typography.bodyLarge)
                    }
                    person?.Overview?.let { o -> Text(o, color = RF.Fg.copy(alpha = 0.88f), style = MaterialTheme.typography.bodyLarge, maxLines = 6, overflow = TextOverflow.Ellipsis) }
                    titles?.let { Text(if (movies.isEmpty() && shows.isEmpty()) "Nothing on this server with them yet." else "${movies.size + shows.size} on this server", color = RF.Muted, style = MaterialTheme.typography.bodyMedium) }
                }
            }
        }
        if (movies.isNotEmpty()) item { ContentRow("Movies", movies, { m -> api.image(m, "Primary", 300) }, onOpen = onOpen, onFocusItem = {}, poster = true) }
        if (shows.isNotEmpty()) item { ContentRow("TV shows", shows, { m -> api.image(m, "Primary", 300) }, onOpen = onOpen, onFocusItem = {}, poster = true) }
    }
}
