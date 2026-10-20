package stream.reelforge.tv.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import java.util.UUID

private val Context.store by preferencesDataStore("reelforge")

/** Remembers the server, the signed-in profile and a few viewing preferences on the TV. */
class SessionStore(private val context: Context) {
    private object K {
        val server = stringPreferencesKey("server")
        val token = stringPreferencesKey("token")
        val userId = stringPreferencesKey("userId")
        val userName = stringPreferencesKey("userName")
        val imageTag = stringPreferencesKey("imageTag")
        val admin = booleanPreferencesKey("admin")
        val deviceId = stringPreferencesKey("deviceId")
        val maxBitrate = stringPreferencesKey("maxBitrate")
        val subtitleLang = stringPreferencesKey("subtitleLang")
    }

    suspend fun deviceId(): String {
        context.store.data.first()[K.deviceId]?.let { return it }
        val id = UUID.randomUUID().toString()
        context.store.edit { it[K.deviceId] = id }
        return id
    }

    suspend fun lastServer(): String? = context.store.data.first()[K.server]

    suspend fun load(): Session? {
        val p = context.store.data.first()
        val server = p[K.server] ?: return null
        val token = p[K.token] ?: return null
        val userId = p[K.userId] ?: return null
        return Session(server, token, userId, p[K.userName].orEmpty(), p[K.admin] ?: false, p[K.imageTag])
    }

    suspend fun save(s: Session) {
        context.store.edit {
            it[K.server] = s.server
            it[K.token] = s.token
            it[K.userId] = s.userId
            it[K.userName] = s.userName
            it[K.admin] = s.isAdmin
            if (s.imageTag != null) it[K.imageTag] = s.imageTag else it.remove(K.imageTag)
        }
    }

    suspend fun rememberServer(server: String) {
        context.store.edit { it[K.server] = server }
    }

    /** Sign out but keep the server, so the profile picker comes up next. */
    suspend fun signOut() {
        context.store.edit {
            it.remove(K.token); it.remove(K.userId); it.remove(K.userName); it.remove(K.admin); it.remove(K.imageTag)
        }
    }

    suspend fun forgetServer() {
        context.store.edit { it.remove(K.server) }
        signOut()
    }

    suspend fun maxBitrate(): Long = context.store.data.first()[K.maxBitrate]?.toLongOrNull() ?: 400_000_000L

    suspend fun setMaxBitrate(bps: Long) {
        context.store.edit { it[K.maxBitrate] = bps.toString() }
    }
}
