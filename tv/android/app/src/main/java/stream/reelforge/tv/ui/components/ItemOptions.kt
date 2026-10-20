package stream.reelforge.tv.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import kotlinx.coroutines.launch
import stream.reelforge.tv.appState
import stream.reelforge.tv.data.Item
import stream.reelforge.tv.ui.theme.RF

/** Hold OK on a tile: quick actions without opening the title (like right-click on the web app). */
@Composable
fun ItemOptions(item: Item, onDismiss: () -> Unit, onPlay: (Item) -> Unit, onOpen: (Item) -> Unit, onChanged: () -> Unit) {
    val state = LocalContext.current.appState
    val scope = rememberCoroutineScope()
    val first = remember { FocusRequester() }
    val fav = item.UserData?.IsFavorite == true
    val played = item.UserData?.Played == true
    LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.width(380.dp).background(RF.Deep, RoundedCornerShape(10.dp)).padding(22.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(if (item.isEpisode) "${item.SeriesName} · ${item.Name}" else item.Name, style = MaterialTheme.typography.titleLarge, color = RF.Fg, maxLines = 2)
            val wide = Modifier.fillMaxWidth()
            if (item.isPlayable) PrimaryButton(if ((item.UserData?.PlayedPercentage ?: 0.0) > 0) "Resume" else "Play", Icons.Play, wide.focusRequester(first)) { onDismiss(); onPlay(item) }
            SecondaryButton(if (item.isEpisode) "Go to show" else "More info", Icons.Film, if (item.isPlayable) wide else wide.focusRequester(first)) { onDismiss(); onOpen(item) }
            SecondaryButton(if (fav) "Remove from My List" else "Add to My List", if (fav) Icons.Check else Icons.Plus, wide) {
                scope.launch { runCatching { state.api?.setFavorite(item.Id, !fav) }; onChanged(); onDismiss() }
            }
            SecondaryButton(if (played) "Mark as unwatched" else "Mark as watched", Icons.Check, wide) {
                scope.launch { runCatching { state.api?.setPlayed(item.Id, !played) }; onChanged(); onDismiss() }
            }
        }
    }
}
