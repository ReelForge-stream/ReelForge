package stream.reelforge.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import stream.reelforge.tv.data.Item
import stream.reelforge.tv.player.PlayerScreen
import stream.reelforge.tv.ui.screens.ConnectScreen
import stream.reelforge.tv.ui.screens.DetailsScreen
import stream.reelforge.tv.ui.screens.MainScreen
import stream.reelforge.tv.ui.screens.ProfilesScreen
import stream.reelforge.tv.ui.theme.RF
import stream.reelforge.tv.ui.theme.ReelForgeTheme
import java.net.URLDecoder
import java.net.URLEncoder

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { ReelForgeTheme { AppRoot() } }
    }
}

@Composable
fun AppRoot() {
    val state = LocalContext.current.appState
    var start by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        start = when {
            state.restore() != null -> "main"
            state.store.lastServer() != null -> "profiles/${enc(state.store.lastServer()!!)}"
            else -> "connect"
        }
    }
    val begin = start ?: return Box(Modifier.fillMaxSize().background(RF.Base))
    val nav = rememberNavController()
    fun open(i: Item) {
        val target = if (i.isEpisode && i.SeriesId != null) i.SeriesId else i.Id
        nav.navigate("details/$target")
    }
    fun play(i: Item, fromStart: Boolean = false) = nav.navigate("play/${i.Id}?start=$fromStart")

    NavHost(nav, startDestination = begin) {
        composable("connect") {
            ConnectScreen { server -> nav.navigate("profiles/${enc(server)}") { popUpTo("connect") { inclusive = true } } }
        }
        composable("profiles/{server}", listOf(navArgument("server") { type = NavType.StringType })) { e ->
            val server = URLDecoder.decode(e.arguments!!.getString("server")!!, "UTF-8")
            ProfilesScreen(
                server,
                onSignedIn = { nav.navigate("main") { popUpTo(0) } },
                onChangeServer = { nav.navigate("connect") { popUpTo(0) } },
            )
        }
        composable("main") {
            MainScreen(
                onOpen = ::open,
                onPlay = { play(it) },
                onSignedOut = { nav.navigate("connect") { popUpTo(0) } },
                onSwitchProfile = {
                    val server = state.session?.server ?: ""
                    nav.navigate(if (server.isEmpty()) "connect" else "profiles/${enc(server)}") { popUpTo(0) }
                },
            )
        }
        composable("details/{id}") { e ->
            DetailsScreen(e.arguments!!.getString("id")!!, onPlay = { i, fromStart -> play(i, fromStart) }, onOpen = ::open)
        }
        composable("play/{id}?start={start}", listOf(navArgument("start") { type = NavType.BoolType; defaultValue = false })) { e ->
            PlayerScreen(
                e.arguments!!.getString("id")!!,
                e.arguments!!.getBoolean("start"),
                onExit = { nav.popBackStack() },
                onNext = { n -> nav.navigate("play/${n.Id}?start=true") { popUpTo("play/{id}?start={start}") { inclusive = true } } },
            )
        }
    }
}

private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
