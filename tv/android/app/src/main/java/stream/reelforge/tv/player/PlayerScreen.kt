package stream.reelforge.tv.player

import android.view.KeyEvent
import android.view.ViewGroup
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import coil3.compose.AsyncImage
import stream.reelforge.tv.data.Autoplay
import stream.reelforge.tv.ui.components.Icons
import stream.reelforge.tv.ui.components.PrimaryButton
import stream.reelforge.tv.ui.components.SecondaryButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import stream.reelforge.tv.appState
import stream.reelforge.tv.data.DeviceProfile
import stream.reelforge.tv.data.Item
import stream.reelforge.tv.data.MediaSource
import stream.reelforge.tv.ui.theme.RF

private const val TICKS = 10_000L // ticks per millisecond

/**
 * Plays a title with Android's own video player (4K, HDR and surround straight through when the TV
 * supports them). Falls back to the server's converted stream if the TV can't play the file.
 * Remote: OK = pause/play, left/right = skip, up/down = controls (audio, subtitles, speed).
 */
@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(id: String, fromStart: Boolean, auto: Boolean, onExit: () -> Unit, onNext: (Item, Boolean) -> Unit, onShow: (String) -> Unit) {
    val context = LocalContext.current
    val state = context.appState
    val api = state.api ?: return
    val scope = rememberCoroutineScope()
    var item by remember { mutableStateOf<Item?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var controlsVisible by remember { mutableStateOf(true) }
    var forceStream by remember { mutableStateOf(false) }
    var session by remember { mutableStateOf<Triple<MediaSource, String?, Boolean>?>(null) } // source, playSessionId, converted
    var next by remember { mutableStateOf<Item?>(null) }
    var resumeMs by remember { mutableStateOf<Long?>(null) }
    // Autoplay: started by hand resets the count of episodes that played by themselves.
    val prefs = remember { Autoplay.load(context) }
    remember(id) { if (!auto) state.autoPlayed = 0; 0 }
    var dismissed by remember(id) { mutableStateOf(false) }
    var asking by remember(id) { mutableStateOf(false) }
    var positionSec by remember { mutableLongStateOf(0L) }
    var durationSec by remember { mutableLongStateOf(0L) }
    val touched = { state.autoPlayed = 0 }

    val player = remember {
        ExoPlayer.Builder(context)
            .setSeekBackIncrementMs(10_000)
            .setSeekForwardIncrementMs(10_000)
            .build()
            .apply { playWhenReady = true }
    }

    fun report(extra: JsonObject.() -> Unit = {}): JsonObject? {
        val (src, ps, converted) = session ?: return null
        return buildJsonObject {
            put("ItemId", id)
            put("MediaSourceId", src.Id)
            ps?.let { put("PlaySessionId", it) }
            put("PositionTicks", player.currentPosition * TICKS)
            put("IsPaused", !player.isPlaying)
            put("CanSeek", true)
            put("PlayMethod", if (converted) "Transcode" else "DirectPlay")
        }
    }

    // Load the title and start playback (again with the server converting, if the TV couldn't play it).
    LaunchedEffect(id, forceStream) {
        try {
            val it = item ?: api.item(id).also { i -> item = i }
            if (it.isEpisode && it.SeriesId != null && it.SeasonId != null) {
                next = runCatching {
                    api.episodes(it.SeriesId, it.SeasonId).firstOrNull { e -> (e.IndexNumber ?: 0) > (it.IndexNumber ?: 0) }
                        ?: api.allEpisodes(it.SeriesId).let { all -> all.getOrNull(all.indexOfFirst { e -> e.Id == it.Id } + 1).takeIf { _ -> all.any { e -> e.Id == it.Id } } }
                }.getOrNull()
            }
            val startMs = resumeMs ?: if (fromStart) 0L else (it.UserData?.PlaybackPositionTicks ?: 0L) / TICKS
            val bitrate = state.store.maxBitrate()
            val info = api.playbackInfo(id, DeviceProfile.build(state.caps, bitrate), bitrate, startMs * TICKS, forceStream = forceStream)
            val src = info.MediaSources.firstOrNull() ?: throw IllegalStateException(info.ErrorCode ?: "The server didn’t offer a playable version.")
            val (url, converted) = api.streamUrl(id, src, info.PlaySessionId)
            session = Triple(src, info.PlaySessionId, converted)

            val subs = src.MediaStreams.filter { s -> s.Type == "Subtitle" && s.DeliveryMethod == "External" && s.DeliveryUrl != null }.map { s ->
                MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(api.subtitleUrl(s.DeliveryUrl!!)))
                    .setMimeType(
                        when ((s.Codec ?: "").lowercase()) {
                            "ass", "ssa" -> MimeTypes.TEXT_SSA
                            "vtt", "webvtt" -> MimeTypes.TEXT_VTT
                            else -> MimeTypes.APPLICATION_SUBRIP
                        },
                    )
                    .setLanguage(s.Language)
                    .setLabel(s.DisplayTitle ?: s.Language)
                    .setSelectionFlags(if (s.IsForced || s.IsDefault) C.SELECTION_FLAG_DEFAULT else 0)
                    .build()
            }
            val mediaItem = MediaItem.Builder().setUri(url).setSubtitleConfigurations(subs).apply { if (converted) setMimeType(MimeTypes.APPLICATION_M3U8) }.build()
            val http = DefaultHttpDataSource.Factory().setDefaultRequestProperties(mapOf("Authorization" to api.authHeader)).setAllowCrossProtocolRedirects(true)
            val mediaSource = if (converted) HlsMediaSource.Factory(http).createMediaSource(mediaItem) else DefaultMediaSourceFactory(http).createMediaSource(mediaItem)
            player.setMediaSource(mediaSource, startMs)
            player.prepare()
            error = null
            report()?.let { r -> api.reportStart(r) }
        } catch (e: Exception) {
            error = e.message ?: "Couldn’t start playback."
        }
    }

    // Where we are, for the "Next episode in 12" card.
    LaunchedEffect(session) {
        while (isActive && session != null) {
            positionSec = player.currentPosition / 1000
            durationSec = player.duration.takeIf { it > 0 }?.div(1000) ?: 0
            delay(500)
        }
    }

    // Progress every 10 seconds, so Continue Watching and other devices know where you are.
    LaunchedEffect(session) {
        while (isActive && session != null) {
            delay(10_000)
            report()?.let { api.reportProgress(it) }
        }
    }

    DisposableEffect(Unit) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(s: Int) {
                if (s == Player.STATE_ENDED) {
                    report()?.let { r -> scope.launch { api.reportStopped(r) } }
                    when (Autoplay.atEnd(prefs, state.autoPlayed, next != null, dismissed)) {
                        Autoplay.End.NEXT -> {
                            state.autoPlayed += 1
                            onNext(next!!, true)
                        }
                        Autoplay.End.ASK -> asking = true
                        Autoplay.End.STOP -> onExit()
                    }
                }
            }

            override fun onPlayerError(e: PlaybackException) {
                // The TV couldn't decode the original: ask the server to convert it instead.
                if (!forceStream && session?.third == false) {
                    resumeMs = player.currentPosition
                    forceStream = true
                } else {
                    error = "Playback stopped: ${e.errorCodeName}. Try a lower picture quality in Settings."
                }
            }
        }
        player.addListener(listener)
        onDispose {
            player.removeListener(listener)
            val r = report()
            val ps = session?.second
            val converted = session?.third == true
            scope.launch {
                r?.let { api.reportStopped(it) }
                if (converted && ps != null) api.stopEncoding(ps)
            }
            player.release()
        }
    }

    val upNext = next != null && !asking && Autoplay.showUpNext(prefs, state.autoPlayed, next != null, dismissed, positionSec, durationSec)
    BackHandler(enabled = upNext) { dismissed = true }
    BackHandler(enabled = asking) { item?.SeriesId?.let(onShow) ?: onExit() }

    Box(Modifier.fillMaxSize().background(Color.Black).onPreviewKeyEvent { touched(); false }) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                    this.player = player
                    useController = true
                    controllerShowTimeoutMs = 3500
                    setShowSubtitleButton(true)
                    setShowNextButton(false)
                    setShowPreviousButton(false)
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    keepScreenOn = true
                    setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { v -> controlsVisible = v == android.view.View.VISIBLE })
                    isFocusable = true
                    isFocusableInTouchMode = true
                    requestFocus()
                    setOnKeyListener { _, code, ev ->
                        // OK toggles pause without first having to reveal the controls.
                        if (ev.action == KeyEvent.ACTION_DOWN && (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER) && !isControllerFullyVisible) {
                            if (player.isPlaying) player.pause() else player.play()
                            showController()
                            true
                        } else {
                            false
                        }
                    }
                }
            },
            modifier = Modifier.fillMaxSize(),
        )
        if (controlsVisible || error != null) {
            Column(
                Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.7f), Color.Transparent))).padding(start = 48.dp, top = 32.dp, end = 48.dp, bottom = 48.dp),
            ) {
                item?.let { i ->
                    Text(if (i.isEpisode) i.SeriesName ?: i.Name else i.Name, style = MaterialTheme.typography.headlineMedium, color = RF.Fg)
                    if (i.isEpisode) Text("${i.episodeCode} · ${i.Name}", style = MaterialTheme.typography.titleMedium, color = RF.Fg.copy(alpha = 0.8f))
                    session?.let { (_, _, converted) -> Text(if (converted) "Converted by the server for this TV" else "Original file", style = MaterialTheme.typography.bodySmall, color = RF.Muted) }
                }
            }
        }
        error?.let { Text(it, color = RF.Fg, modifier = Modifier.align(Alignment.Center).background(RF.Deep.copy(alpha = 0.85f)).padding(20.dp)) }

        if (upNext) {
            val n = next!!
            val focus = remember { FocusRequester() }
            Row(
                Modifier.align(Alignment.BottomEnd).padding(end = 48.dp, bottom = 110.dp).width(560.dp)
                    .background(RF.Deep.copy(alpha = 0.94f), RoundedCornerShape(10.dp)).padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AsyncImage(api.image(n, "Primary", 400), null, contentScale = ContentScale.Crop, modifier = Modifier.width(180.dp).aspectRatio(16f / 9f).background(RF.Surface, RoundedCornerShape(6.dp)))
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Next episode in ${(durationSec - positionSec).coerceAtLeast(0)}", color = RF.Ember, style = MaterialTheme.typography.titleSmall)
                    Text("${n.episodeCode} · ${n.Name}", color = RF.Fg, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        PrimaryButton("Play now", Icons.Play, Modifier.focusRequester(focus)) { onNext(n, false) }
                        SecondaryButton("Cancel") { dismissed = true }
                    }
                }
            }
            LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
        }

        if (asking) {
            val i = item
            val focus = remember { FocusRequester() }
            Column(
                Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.88f)),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
            ) {
                Text("Are you still watching${if (i?.isEpisode == true) " ${i.SeriesName}" else ""}?", style = MaterialTheme.typography.displaySmall, color = RF.Fg)
                next?.let { n -> Text("Up next: ${n.episodeCode} · ${n.Name}", color = RF.Muted, style = MaterialTheme.typography.titleMedium) }
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(top = 12.dp)) {
                    next?.let { n -> PrimaryButton("Continue watching", Icons.Play, Modifier.focusRequester(focus)) { onNext(n, false) } }
                    SecondaryButton("Back to the show") { i?.SeriesId?.let(onShow) ?: onExit() }
                }
            }
            LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
        }
    }
}
