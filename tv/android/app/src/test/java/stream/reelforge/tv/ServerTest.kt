package stream.reelforge.tv

import android.content.Context
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import stream.reelforge.tv.data.DeviceProfile
import stream.reelforge.tv.data.JellyfinApi
import stream.reelforge.tv.data.Session
import stream.reelforge.tv.ui.screens.ConnectScreen
import stream.reelforge.tv.ui.screens.DetailsScreen
import stream.reelforge.tv.ui.screens.HomeContent
import stream.reelforge.tv.ui.screens.LibraryContent
import stream.reelforge.tv.ui.screens.MainScreen
import stream.reelforge.tv.ui.screens.ProfilesScreen
import stream.reelforge.tv.ui.screens.SearchContent
import stream.reelforge.tv.ui.theme.ReelForgeTheme

/**
 * Runs against a real ReelForge server when RF_TEST_SERVER is set (e.g. http://localhost:8096 with
 * RF_TEST_USER / RF_TEST_PASSWORD), and saves pictures of the TV screens to build/outputs/roborazzi.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w960dp-h540dp-land-xhdpi")
class ServerTest {
    @get:Rule val compose = createComposeRule()

    private val server = System.getenv("RF_TEST_SERVER")
    private val user = System.getenv("RF_TEST_USER") ?: "cade"
    private val pw = System.getenv("RF_TEST_PASSWORD") ?: ""
    private val out = System.getenv("RF_SHOTS") ?: "build/outputs/roborazzi"
    private lateinit var api: JellyfinApi

    @Before fun signIn() {
        assumeTrue("set RF_TEST_SERVER to run against a server", server != null)
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        runBlocking {
            api = ctx.appState.guestApi(server!!)
            val r = api.signIn(user, pw)
            ctx.appState.signedIn(server, api, Session(server, r.AccessToken, r.User.Id, r.User.Name, true, null))
        }
    }

    private fun shot(name: String, waitMs: Long = 4000, content: @androidx.compose.runtime.Composable () -> Unit) {
        compose.setContent { ReelForgeTheme { content() } }
        // Let the screen fetch from the server and settle (waitUntil keeps the UI ticking while it waits).
        val until = System.currentTimeMillis() + waitMs
        runCatching { compose.waitUntil(waitMs + 1000) { System.currentTimeMillis() > until } }
        compose.onRoot().captureRoboImage("$out/$name.png")
    }

    private val movies by lazy { runBlocking { api.views().first { it.CollectionType == "movies" } } }

    @Test fun browse_and_playback_decisions() = runBlocking {
        val views = api.views()
        assertTrue(views.any { it.CollectionType == "movies" })
        val movies = views.first { it.CollectionType == "movies" }
        val all = api.items(parentId = movies.Id, types = "Movie", limit = 500).Items
        assertTrue(all.isNotEmpty())
        val track = all.first { it.Name.startsWith("Track Test") }
        // A TV that decodes VP9 + Opus plays the file as-is...
        val direct = api.playbackInfo(track.Id, DeviceProfile.build(DeviceProfile.Caps(listOf("h264", "vp9"), listOf("aac", "opus"), false), 120_000_000), 120_000_000, 0)
        val src = direct.MediaSources.first()
        assertTrue(src.SupportsDirectPlay)
        assertTrue(api.streamUrl(track.Id, src, direct.PlaySessionId).first.contains("/stream?static=true"))
        // ...one that only does H.264 gets the server's converted stream.
        val converted = api.playbackInfo(track.Id, DeviceProfile.build(DeviceProfile.Caps(listOf("h264"), listOf("aac"), false), 120_000_000), 120_000_000, 0)
        val (url, isHls) = api.streamUrl(track.Id, converted.MediaSources.first(), converted.PlaySessionId)
        assertTrue(isHls)
        assertTrue(url.contains("master.m3u8") || url.contains(".m3u8"))
        // Search index covers everything.
        assertNotNull(api.titleIndex().firstOrNull())
        assertEquals(true, api.publicInfo().StartupWizardCompleted)
    }

    @Test fun shot_home() = shot("tv-home") { MainScreen({}, {}, {}, {}) }
    @Test fun shot_library() = shot("tv-library") { LibraryContent(movies.Id, movies.Name, "movies", {}, {}) }
    @Test fun shot_details() {
        val id = runBlocking { api.items(parentId = movies.Id, types = "Movie", search = "Sleepless").Items.first().Id }
        shot("tv-details", 5000) { DetailsScreen(id, { _, _ -> }, {}) }
    }
    @Test fun shot_search() = shot("tv-search") { SearchContent({}, {}) }
    @Test fun shot_profiles() = shot("tv-profiles") { ProfilesScreen(server!!, {}, {}) }
    @Test fun shot_connect() = shot("tv-connect", 3500) { ConnectScreen {} }
}
