package stream.reelforge.tv.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.tv.material3.DrawerValue
import androidx.tv.material3.Icon
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.NavigationDrawer
import androidx.tv.material3.NavigationDrawerItem
import androidx.tv.material3.NavigationDrawerItemDefaults
import androidx.tv.material3.Text
import androidx.tv.material3.rememberDrawerState
import androidx.compose.foundation.Image
import stream.reelforge.tv.R
import stream.reelforge.tv.appState
import stream.reelforge.tv.data.Item
import stream.reelforge.tv.ui.components.Icons
import stream.reelforge.tv.ui.theme.RF

sealed interface Tab {
    data object Search : Tab
    data object Home : Tab
    data class Library(val id: String, val name: String, val type: String?) : Tab
    data object MyList : Tab
    data object Settings : Tab
}

/** The signed-in app: a side menu (Search, Home, each library, My List, Settings) and the chosen page. */
@Composable
fun MainScreen(onOpen: (Item) -> Unit, onPlay: (Item) -> Unit, onSignedOut: () -> Unit, onSwitchProfile: () -> Unit) {
    val state = LocalContext.current.appState
    var views by remember { mutableStateOf<List<Item>>(emptyList()) }
    var tabKey by rememberSaveable { mutableStateOf("home") }
    LaunchedEffect(Unit) {
        views = runCatching { state.api!!.views() }.getOrDefault(emptyList())
            .filter { it.CollectionType in listOf("movies", "tvshows", "homevideos", "mixed", null) }
            .sortedBy { when (it.CollectionType) { "tvshows" -> 0; "movies" -> 1; else -> 2 } }
    }
    val tabs: List<Pair<String, Tab>> = buildList {
        add("search" to Tab.Search)
        add("home" to Tab.Home)
        views.forEach { add("lib:${it.Id}" to Tab.Library(it.Id, it.Name, it.CollectionType)) }
        add("list" to Tab.MyList)
        add("settings" to Tab.Settings)
    }
    val tab = tabs.firstOrNull { it.first == tabKey }?.second ?: Tab.Home
    val drawer = rememberDrawerState(DrawerValue.Closed)

    NavigationDrawer(
        drawerState = drawer,
        drawerContent = { value ->
            Column(
                Modifier.fillMaxHeight().background(Brush.horizontalGradient(listOf(RF.Deep, RF.Deep.copy(alpha = if (value == DrawerValue.Open) 0.96f else 0f)))).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
            ) {
                Box(Modifier.padding(start = 6.dp, bottom = 14.dp)) {
                    Image(painterResource(R.mipmap.ic_launcher), null, Modifier.size(36.dp))
                }
                tabs.forEach { (key, t) ->
                    val (label, icon) = when (t) {
                        Tab.Search -> "Search" to Icons.Search
                        Tab.Home -> "Home" to Icons.Home
                        is Tab.Library -> t.name to when (t.type) { "movies" -> Icons.Film; "tvshows" -> Icons.Tv; else -> Icons.Folder }
                        Tab.MyList -> "My List" to Icons.Heart
                        Tab.Settings -> (state.session?.userName ?: "Settings") to Icons.Settings
                    }
                    NavigationDrawerItem(
                        selected = key == tabKey,
                        onClick = { tabKey = key },
                        leadingContent = { Icon(icon, null) },
                        colors = NavigationDrawerItemDefaults.colors(
                            selectedContainerColor = RF.Surface2,
                            focusedContainerColor = RF.Fg,
                            focusedContentColor = RF.Base,
                            selectedContentColor = RF.Fg,
                            contentColor = RF.Muted,
                        ),
                    ) { Text(label) }
                }
                Spacer(Modifier.height(40.dp))
            }
        },
    ) {
        Box(Modifier.fillMaxSize().background(RF.Base)) {
            when (tab) {
                Tab.Home -> HomeContent(onOpen, onPlay)
                is Tab.Library -> LibraryContent(tab.id, tab.name, tab.type, onOpen, onPlay)
                Tab.MyList -> MyListContent(onOpen, onPlay)
                Tab.Search -> SearchContent(onOpen, onPlay)
                Tab.Settings -> SettingsContent(onSignedOut, onSwitchProfile)
            }
        }
    }
}

