package stream.reelforge.tv.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import kotlinx.coroutines.launch
import stream.reelforge.tv.BuildConfig
import stream.reelforge.tv.appState
import stream.reelforge.tv.data.Updater
import stream.reelforge.tv.ui.components.PrimaryButton
import stream.reelforge.tv.ui.components.SecondaryButton
import stream.reelforge.tv.ui.theme.RF

private val QUALITIES = listOf(
    400_000_000L to "Original (best)",
    40_000_000L to "4K · 40 Mbps",
    20_000_000L to "1080p · 20 Mbps",
    10_000_000L to "1080p · 10 Mbps",
    4_000_000L to "720p · 4 Mbps",
)

/** Profile, server, playback quality and app updates. */
@Composable
fun SettingsContent(onSignedOut: () -> Unit, onSwitchProfile: () -> Unit) {
    val state = LocalContext.current.appState
    val scope = rememberCoroutineScope()
    val s = state.session
    var bitrate by remember { mutableLongStateOf(400_000_000L) }
    var update by remember { mutableStateOf<Updater.Update?>(null) }
    var checking by remember { mutableStateOf(false) }
    var checked by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf<Float?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { bitrate = state.store.maxBitrate() }

    Column(Modifier.fillMaxSize().padding(start = 48.dp, top = 28.dp, end = 48.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Settings", style = MaterialTheme.typography.displaySmall, color = RF.Fg)

        Section("Profile")
        Text("Signed in as ${s?.userName}", color = RF.Muted, style = MaterialTheme.typography.bodyLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            SecondaryButton("Switch profile") { scope.launch { state.signOut(); onSwitchProfile() } }
            SecondaryButton("Change server") { scope.launch { state.forgetServer(); onSignedOut() } }
        }
        Text("Server: ${s?.server?.removePrefix("http://")}", color = RF.Muted, style = MaterialTheme.typography.bodyMedium)

        Section("Picture quality")
        Text("“Original” plays files untouched whenever this TV can. Lower it if videos buffer, especially away from home.", color = RF.Muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.width(720.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            QUALITIES.forEach { (bps, label) ->
                if (bps == bitrate) PrimaryButton(label) {} else SecondaryButton(label) { bitrate = bps; scope.launch { state.store.setMaxBitrate(bps) } }
            }
        }

        Section("ReelForge for Google TV")
        Text("Version ${BuildConfig.VERSION_NAME}", color = RF.Muted, style = MaterialTheme.typography.bodyLarge)
        when {
            progress != null -> Text("Downloading update… ${((progress ?: 0f) * 100).toInt()}%", color = RF.Fg)
            update != null -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PrimaryButton("Install version ${update!!.version}") {
                    if (!state.updater.canInstall()) {
                        message = "Allow ReelForge to install updates on the next screen, then come back and press Install again."
                        state.updater.openInstallPermission()
                    } else {
                        scope.launch {
                            progress = 0f
                            runCatching { state.updater.downloadAndInstall(update!!) { progress = it } }.onFailure { message = it.message }
                            progress = null
                        }
                    }
                }
            }
            else -> SecondaryButton(if (checking) "Checking…" else "Check for updates", enabled = !checking) {
                checking = true
                scope.launch {
                    update = state.updater.check()
                    checked = true
                    checking = false
                }
            }
        }
        if (checked && update == null && progress == null) Text("You have the latest version.", color = RF.Coolant)
        message?.let { Text(it, color = RF.Muted, modifier = Modifier.width(720.dp)) }
        Text("Signing out of every device and managing profiles is done in ReelForge on your computer.", color = RF.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 20.dp, bottom = 40.dp))
    }
}

@Composable
private fun Section(title: String) {
    Text(title, style = MaterialTheme.typography.headlineSmall, color = RF.Fg, modifier = Modifier.padding(top = 18.dp))
}
