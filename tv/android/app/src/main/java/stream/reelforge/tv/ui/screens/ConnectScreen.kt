package stream.reelforge.tv.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import kotlinx.coroutines.launch
import stream.reelforge.tv.R
import stream.reelforge.tv.appState
import stream.reelforge.tv.data.DiscoveredServer
import stream.reelforge.tv.data.Discovery
import stream.reelforge.tv.data.JellyfinApi
import stream.reelforge.tv.ui.components.ErrorText
import stream.reelforge.tv.ui.components.PrimaryButton
import stream.reelforge.tv.ui.components.SecondaryButton
import stream.reelforge.tv.ui.components.TvTextField
import stream.reelforge.tv.ui.theme.RF

/** First run: find the ReelForge server on the network, or type its address. */
@Composable
fun ConnectScreen(onConnected: (server: String) -> Unit) {
    val state = LocalContext.current.appState
    val scope = rememberCoroutineScope()
    var found by remember { mutableStateOf<List<DiscoveredServer>?>(null) }
    var address by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val first = remember { FocusRequester() }

    fun connect(raw: String) {
        val server = runCatching { JellyfinApi.normalizeAddress(raw) }.getOrNull()
        if (server.isNullOrBlank()) {
            error = "That doesn’t look like an address. Try something like 192.168.1.20"
            return
        }
        busy = true
        error = null
        scope.launch {
            try {
                state.guestApi(server).publicInfo()
                state.store.rememberServer(server)
                onConnected(server)
            } catch (e: Exception) {
                error = "Couldn’t reach a ReelForge server at $server. Check the address and that the server is running."
            } finally {
                busy = false
            }
        }
    }

    LaunchedEffect(Unit) {
        address = state.store.lastServer()?.removePrefix("http://").orEmpty()
        found = Discovery.find()
        runCatching { first.requestFocus() }
    }

    Box(Modifier.fillMaxSize().background(RF.Base).padding(horizontal = 96.dp, vertical = 64.dp)) {
        Column(Modifier.align(Alignment.CenterStart).width(620.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(R.mipmap.ic_launcher), null, Modifier.size(56.dp))
                Spacer(Modifier.width(16.dp))
                Text("ReelForge", style = MaterialTheme.typography.displayMedium, color = RF.Fg)
            }
            Text("Connect to your server", style = MaterialTheme.typography.headlineMedium, color = RF.Fg)
            when {
                found == null -> Text("Looking for ReelForge on your network…", color = RF.Muted, style = MaterialTheme.typography.bodyLarge)
                found!!.isEmpty() -> Text("No server answered on this network. Type its address below.", color = RF.Muted, style = MaterialTheme.typography.bodyLarge)
                else -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Found on your network", color = RF.Muted, style = MaterialTheme.typography.bodyLarge)
                    found!!.forEachIndexed { i, s ->
                        SecondaryButton(
                            "${s.Name.ifBlank { "ReelForge" }}  ·  ${s.Address.removePrefix("http://")}",
                            modifier = if (i == 0) Modifier.focusRequester(first) else Modifier,
                            enabled = !busy,
                        ) { connect(s.Address) }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Text("Or type the address", color = RF.Muted, style = MaterialTheme.typography.bodyLarge)
            TvTextField(
                address,
                { address = it },
                "192.168.1.20 or media-pc.local",
                keyboardType = KeyboardType.Uri,
                modifier = if (found.isNullOrEmpty()) Modifier.focusRequester(first) else Modifier,
                onDone = { connect(address) },
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PrimaryButton(if (busy) "Connecting…" else "Connect", enabled = !busy && address.isNotBlank()) { connect(address) }
                SecondaryButton("Search again", enabled = !busy) {
                    found = null
                    scope.launch { found = Discovery.find() }
                }
            }
            ErrorText(error)
            Text(
                "Tip: the address is shown in ReelForge on your computer under Server settings → General.",
                color = RF.Muted,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}
