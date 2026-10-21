package stream.reelforge.tv

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import stream.reelforge.tv.data.DeviceProfile
import stream.reelforge.tv.data.Item
import stream.reelforge.tv.data.JellyfinApi
import stream.reelforge.tv.data.Session
import stream.reelforge.tv.data.SessionStore
import stream.reelforge.tv.data.Updater

/** App-wide state: which server, who's signed in, and things worth keeping between screens. */
class AppState(private val context: Context) {
    val store = SessionStore(context)
    val updater = Updater(context, BuildConfig.VERSION_NAME)
    val caps by lazy { DeviceProfile.detect(context) }

    var session by mutableStateOf<Session?>(null)
        private set
    var api by mutableStateOf<JellyfinApi?>(null)
        private set

    private var titleCache: Pair<Long, List<Item>>? = null

    /** Episodes in a row that started by themselves with nobody pressing a button. */
    var autoPlayed = 0

    suspend fun restore(): Session? {
        val s = store.load() ?: return null
        api = JellyfinApi(s.server, store.deviceId(), BuildConfig.VERSION_NAME, s.token, s.userId)
        session = s
        return s
    }

    /** An API client for a server we're not signed in to yet (connect / profile screens). */
    suspend fun guestApi(server: String) = JellyfinApi(server, store.deviceId(), BuildConfig.VERSION_NAME)

    suspend fun signedIn(server: String, a: JellyfinApi, s: Session) {
        store.save(s)
        api = a
        session = s
        titleCache = null
    }

    suspend fun signOut() {
        api?.signOut()
        store.signOut()
        api = null
        session = null
        titleCache = null
    }

    suspend fun forgetServer() {
        signOut()
        store.forgetServer()
    }

    /** Every title for search-as-you-type, refreshed every few minutes. */
    suspend fun titles(): List<Item> {
        titleCache?.let { (at, list) -> if (System.currentTimeMillis() - at < 5 * 60_000) return list }
        val list = api?.titleIndex().orEmpty()
        titleCache = System.currentTimeMillis() to list
        return list
    }
}
