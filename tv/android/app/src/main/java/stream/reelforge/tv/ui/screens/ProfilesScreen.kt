package stream.reelforge.tv.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.Card
import androidx.tv.material3.CardDefaults
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import stream.reelforge.tv.appState
import stream.reelforge.tv.data.JellyfinApi
import stream.reelforge.tv.data.Session
import stream.reelforge.tv.data.User
import stream.reelforge.tv.ui.components.ErrorText
import stream.reelforge.tv.ui.components.PrimaryButton
import stream.reelforge.tv.ui.components.SecondaryButton
import stream.reelforge.tv.ui.components.TvTextField
import stream.reelforge.tv.ui.theme.RF
import kotlin.math.absoluteValue

private val tones = listOf(0xFFFF8A1F, 0xFF5FD3A6, 0xFF6F9BD1, 0xFFC77DDB, 0xFFE8C547, 0xFFE46F6F, 0xFF4FB6C2, 0xFF93A4B5)

/** "Who's watching?" (Figma 85:1927) with password and type-your-name fallbacks. */
@Composable
fun ProfilesScreen(server: String, onSignedIn: () -> Unit, onChangeServer: () -> Unit) {
    val state = LocalContext.current.appState
    val scope = rememberCoroutineScope()
    var api by remember { mutableStateOf<JellyfinApi?>(null) }
    var users by remember { mutableStateOf<List<User>?>(null) }
    var pick by remember { mutableStateOf<User?>(null) }
    var manual by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }

    LaunchedEffect(server) {
        val a = state.guestApi(server)
        api = a
        users = runCatching { a.publicUsers() }.getOrElse {
            error = "Can’t reach the server right now."
            emptyList()
        }
        if (users.isNullOrEmpty()) manual = true
    }
    LaunchedEffect(users, pick, manual) { runCatching { focus.requestFocus() } }

    fun signIn(userName: String, pw: String) {
        val a = api ?: return
        busy = true
        error = null
        scope.launch {
            try {
                val r = a.signIn(userName, pw)
                state.signedIn(server, a, Session(server, r.AccessToken, r.User.Id, r.User.Name, r.User.Policy?.IsAdministrator == true, r.User.PrimaryImageTag))
                onSignedIn()
            } catch (e: Exception) {
                error = e.message ?: "Couldn’t sign in."
                if (pick != null && !pick!!.HasPassword) pick = pick!!.copy(HasPassword = true) // server wanted a password after all
            } finally {
                busy = false
            }
        }
    }

    Box(Modifier.fillMaxSize().background(RF.Base), contentAlignment = Alignment.Center) {
        when {
            pick != null -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp), modifier = Modifier.width(520.dp)) {
                Avatar(pick!!, api, 120)
                Text("Enter the password for ${pick!!.Name}", style = MaterialTheme.typography.headlineMedium, color = RF.Fg, textAlign = TextAlign.Center)
                TvTextField(password, { password = it }, "Password", password = true, modifier = Modifier.focusRequester(focus), onDone = { signIn(pick!!.Name, password) })
                ErrorText(error)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    PrimaryButton(if (busy) "Signing in…" else "Continue", enabled = !busy && password.isNotEmpty()) { signIn(pick!!.Name, password) }
                    SecondaryButton("Back") { pick = null; password = ""; error = null }
                }
            }
            manual -> Column(verticalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.width(520.dp)) {
                Text("Sign in", style = MaterialTheme.typography.displaySmall, color = RF.Fg)
                TvTextField(name, { name = it }, "Name", modifier = Modifier.focusRequester(focus))
                TvTextField(password, { password = it }, "Password", password = true, onDone = { signIn(name, password) })
                ErrorText(error)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    PrimaryButton(if (busy) "Signing in…" else "Sign in", enabled = !busy && name.isNotBlank()) { signIn(name.trim(), password) }
                    if (!users.isNullOrEmpty()) SecondaryButton("Back to profiles") { manual = false; error = null }
                    SecondaryButton("Change server") { onChangeServer() }
                }
            }
            else -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Who’s watching?", style = MaterialTheme.typography.displayLarge.copy(fontSize = 44.sp), color = RF.Fg)
                Spacer(Modifier.height(36.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                    users.orEmpty().forEachIndexed { i, u ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Card(
                                onClick = { if (u.HasPassword) pick = u else { pick = null; signIn(u.Name, "") } },
                                modifier = Modifier.size(124.dp).then(if (i == 0) Modifier.focusRequester(focus) else Modifier),
                                shape = CardDefaults.shape(RoundedCornerShape(6.dp)),
                                border = CardDefaults.border(focusedBorder = Border(androidx.compose.foundation.BorderStroke(4.dp, RF.Fg), shape = RoundedCornerShape(6.dp))),
                                scale = CardDefaults.scale(focusedScale = 1.08f),
                            ) { Avatar(u, api, 124) }
                            Spacer(Modifier.height(12.dp))
                            Text(u.Name, color = RF.Muted, style = MaterialTheme.typography.titleLarge)
                        }
                    }
                }
                Spacer(Modifier.height(40.dp))
                ErrorText(error)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    SecondaryButton("Sign in another way") { manual = true }
                    SecondaryButton("Change server") { onChangeServer() }
                }
            }
        }
    }
}

@Composable
fun Avatar(u: User, api: JellyfinApi?, size: Int) {
    val url = api?.userImage(u, size * 2)
    Box(Modifier.size(size.dp).aspectRatio(1f), contentAlignment = Alignment.Center) {
        if (url != null) {
            AsyncImage(url, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            val tone = Color(tones[u.Name.hashCode().absoluteValue % tones.size])
            Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(tone, tone.copy(alpha = 0.55f).compositeOver(RF.Base)))), contentAlignment = Alignment.Center) {
                Text(u.Name.trim().take(1).uppercase(), color = RF.Deep.copy(alpha = 0.85f), fontSize = (size * 0.46).sp, style = MaterialTheme.typography.displayLarge)
            }
        }
    }
}

private fun Color.compositeOver(bg: Color): Color {
    val a = alpha
    return Color(red * a + bg.red * (1 - a), green * a + bg.green * (1 - a), blue * a + bg.blue * (1 - a), 1f)
}

