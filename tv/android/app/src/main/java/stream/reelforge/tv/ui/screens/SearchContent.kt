package stream.reelforge.tv.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import stream.reelforge.tv.appState
import stream.reelforge.tv.data.Fuzzy
import stream.reelforge.tv.data.Item
import stream.reelforge.tv.ui.components.ItemOptions
import stream.reelforge.tv.ui.components.PosterCard
import stream.reelforge.tv.ui.components.TvTextField
import stream.reelforge.tv.ui.theme.RF

/** Search as you type, forgiving typos and initials (same matching as the web app). */
@Composable
fun SearchContent(onOpen: (Item) -> Unit, onPlay: (Item) -> Unit) {
    val state = LocalContext.current.appState
    val api = state.api ?: return
    var q by remember { mutableStateOf("") }
    var titles by remember { mutableStateOf<List<Item>?>(null) }
    var options by remember { mutableStateOf<Item?>(null) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        titles = runCatching { state.titles() }.getOrDefault(emptyList())
        runCatching { focus.requestFocus() }
    }
    val results = remember(q, titles) { if (q.isBlank()) emptyList() else Fuzzy.search(q, titles.orEmpty(), 60) }

    Column(Modifier.fillMaxSize().padding(top = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Search", style = MaterialTheme.typography.displaySmall, color = RF.Fg, modifier = Modifier.padding(start = 48.dp))
        TvTextField(q, { q = it }, "Titles: typos and initials like “lotr” work too", modifier = Modifier.padding(horizontal = 48.dp).width(640.dp).focusRequester(focus))
        when {
            titles == null -> Text("Loading your library…", color = RF.Muted, modifier = Modifier.padding(horizontal = 48.dp))
            q.isNotBlank() && results.isEmpty() -> Text("Nothing in your library is close to “$q”.", color = RF.Muted, modifier = Modifier.padding(horizontal = 48.dp), style = MaterialTheme.typography.bodyLarge)
        }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(132.dp),
            contentPadding = PaddingValues(start = 48.dp, end = 48.dp, top = 12.dp, bottom = 48.dp),
            horizontalArrangement = Arrangement.spacedBy(20.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            items(results, key = { it.Id }) { item ->
                PosterCard(item, api.image(item, "Primary", 300), 132.dp, onClick = { onOpen(item) }, onLongClick = { options = item })
            }
        }
    }
    options?.let { o -> ItemOptions(o, { options = null }, onPlay, onOpen) {} }
}
