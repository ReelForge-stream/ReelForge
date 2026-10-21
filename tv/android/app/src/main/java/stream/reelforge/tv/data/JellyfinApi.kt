package stream.reelforge.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, message: String) : IOException(message)

val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
    coerceInputValues = true
}

/** Talks to a ReelForge (Jellyfin) server: sign-in, browsing, artwork and playback. */
class JellyfinApi(
    val server: String,
    private val deviceId: String,
    private val appVersion: String,
    var token: String? = null,
    var userId: String? = null,
    private val http: OkHttpClient = defaultClient,
) {
    companion object {
        const val CLIENT = "ReelForge Android TV"
        val defaultClient: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
        private val JSON_TYPE = "application/json".toMediaType()
        const val FIELDS = "Overview,Genres,ProductionYear,OfficialRating,CommunityRating,ChildCount,DateCreated,SortName,OriginalTitle"

        /** "192.168.1.20" → "http://192.168.1.20:8096"; keeps a given scheme or port. */
        fun normalizeAddress(raw: String): String {
            var s = raw.trim().trimEnd('/')
            if (s.isEmpty()) return s
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://$s"
            val url = s.toHttpUrl()
            val hasPort = Regex("^https?://[^/]+:\\d+").containsMatchIn(s)
            return if (hasPort || url.scheme == "https") s else "${url.scheme}://${url.host}:8096${url.encodedPath.trimEnd('/')}"
        }
    }

    val authHeader: String
        get() = buildString {
            append("MediaBrowser Client=\"$CLIENT\", Device=\"${android.os.Build.MODEL.replace("\"", "")}\", DeviceId=\"$deviceId\", Version=\"$appVersion\"")
            token?.let { append(", Token=\"$it\"") }
        }

    private suspend fun call(method: String, path: String, body: String? = null): String = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url(server + path)
            .header("Authorization", authHeader)
            .method(method, body?.toRequestBody(JSON_TYPE) ?: if (method == "POST") "".toRequestBody(JSON_TYPE) else null)
            .build()
        http.newCall(req).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw ApiException(res.code, if (res.code == 401) "Sign-in needed" else "The server answered ${res.code}")
            text
        }
    }

    private suspend inline fun <reified T> get(path: String): T = json.decodeFromString(call("GET", path))
    private suspend inline fun <reified T> post(path: String, body: String): T = json.decodeFromString(call("POST", path, body))

    private val uid get() = userId ?: throw ApiException(401, "Not signed in")

    // ---------- connecting ----------

    suspend fun publicInfo(): PublicInfo = get("/System/Info/Public")

    suspend fun publicUsers(): List<User> = get("/Users/Public")

    suspend fun signIn(name: String, password: String): AuthResult {
        val body = buildJsonObject { put("Username", name); put("Pw", password) }.toString()
        val r: AuthResult = try {
            post("/Users/AuthenticateByName", body)
        } catch (e: ApiException) {
            if (e.status == 401) throw ApiException(401, "That password isn’t right.") else throw e
        }
        token = r.AccessToken
        userId = r.User.Id
        return r
    }

    suspend fun signOut() {
        runCatching { call("POST", "/Sessions/Logout") }
    }

    // ---------- browsing ----------

    suspend fun views(): List<Item> = get<ItemsResult>("/UserViews?userId=$uid").Items

    suspend fun resume(): List<Item> = get<ItemsResult>("/UserItems/Resume?userId=$uid&limit=16&mediaTypes=Video&fields=$FIELDS").Items

    suspend fun nextUp(): List<Item> = get<ItemsResult>("/Shows/NextUp?userId=$uid&limit=16&fields=$FIELDS").Items

    suspend fun latest(parentId: String): List<Item> = get("/Items/Latest?userId=$uid&parentId=$parentId&limit=20&fields=$FIELDS")

    suspend fun items(
        parentId: String? = null,
        types: String? = null,
        sortBy: String = "SortName",
        sortOrder: String = "Ascending",
        start: Int = 0,
        limit: Int = 60,
        favorites: Boolean = false,
        search: String? = null,
        genre: String? = null,
        fields: String = FIELDS,
        withImage: String? = null,
    ): ItemsResult {
        val q = buildList {
            add("userId=$uid"); add("recursive=true"); add("fields=$fields")
            add("sortBy=$sortBy"); add("sortOrder=$sortOrder"); add("startIndex=$start"); add("limit=$limit")
            add("enableTotalRecordCount=true")
            parentId?.let { add("parentId=$it") }
            withImage?.let { add("imageTypes=$it") }
            types?.let { add("includeItemTypes=$it") }
            if (favorites) add("filters=IsFavorite")
            search?.let { add("searchTerm=${enc(it)}") }
            genre?.let { add("genres=${enc(it)}") }
        }.joinToString("&")
        return get("/Items?$q")
    }

    /** Every movie and show in one light list, for instant search as you type. */
    suspend fun titleIndex(): List<Item> =
        items(types = "Movie,Series", limit = 50000, fields = "SortName,OriginalTitle,ProductionYear,CommunityRating").Items

    suspend fun item(id: String): Item = get("/Items/$id?userId=$uid&fields=$FIELDS,People,Studios,Taglines,MediaSources")

    suspend fun seasons(seriesId: String): List<Item> = get<ItemsResult>("/Shows/$seriesId/Seasons?userId=$uid").Items

    suspend fun episodes(seriesId: String, seasonId: String): List<Item> =
        get<ItemsResult>("/Shows/$seriesId/Episodes?userId=$uid&seasonId=$seasonId&fields=Overview").Items

    suspend fun similar(id: String): List<Item> = get<ItemsResult>("/Items/$id/Similar?userId=$uid&limit=12&fields=$FIELDS").Items

    suspend fun setFavorite(id: String, fav: Boolean) {
        call(if (fav) "POST" else "DELETE", "/UserFavoriteItems/$id?userId=$uid")
    }

    suspend fun setPlayed(id: String, played: Boolean) {
        call(if (played) "POST" else "DELETE", "/UserPlayedItems/$id?userId=$uid")
    }

    // ---------- artwork ----------

    fun image(item: Item, kind: String, maxWidth: Int): String? {
        fun url(id: String, type: String, tag: String, index: String = "") = "$server/Items/$id/Images/$type$index?maxWidth=$maxWidth&quality=90&tag=$tag"
        return when (kind) {
            "Backdrop" -> item.BackdropImageTags?.firstOrNull()?.let { url(item.Id, "Backdrop", it, "/0") }
                ?: item.ParentBackdropImageTags?.firstOrNull()?.let { t -> item.ParentBackdropItemId?.let { url(it, "Backdrop", t, "/0") } }
            "Logo" -> item.ImageTags?.get("Logo")?.let { url(item.Id, "Logo", it) }
                ?: item.ParentLogoImageTag?.let { t -> item.ParentLogoItemId?.let { url(it, "Logo", t) } }
            "Thumb" -> item.ImageTags?.get("Thumb")?.let { url(item.Id, "Thumb", it) }
                ?: (if (!item.isEpisode) item.ParentThumbImageTag?.let { t -> item.ParentThumbItemId?.let { url(it, "Thumb", t) } } else null)
                ?: (if (item.isEpisode) item.ImageTags?.get("Primary")?.let { url(item.Id, "Primary", it) } else null)
                ?: image(item, "Backdrop", maxWidth)
            else -> item.ImageTags?.get("Primary")?.let { url(item.Id, "Primary", it) }
                ?: item.SeriesPrimaryImageTag?.let { t -> item.SeriesId?.let { url(it, "Primary", t) } }
        }
    }

    fun userImage(u: User, size: Int): String? = u.PrimaryImageTag?.let { "$server/Users/${u.Id}/Images/Primary?width=$size&quality=90&tag=$it" }

    // ---------- playback ----------

    suspend fun playbackInfo(
        itemId: String,
        profile: JsonObject,
        maxBitrate: Long,
        startTicks: Long,
        mediaSourceId: String? = null,
        audioIndex: Int? = null,
        subtitleIndex: Int? = null,
        forceStream: Boolean = false,
    ): PlaybackInfo {
        val q = buildList {
            add("userId=$uid")
            mediaSourceId?.let { add("mediaSourceId=$it") }
            audioIndex?.let { add("audioStreamIndex=$it") }
            subtitleIndex?.let { add("subtitleStreamIndex=$it") }
        }.joinToString("&")
        val body = buildJsonObject {
            put("DeviceProfile", profile)
            put("MaxStreamingBitrate", maxBitrate)
            put("StartTimeTicks", startTicks)
            mediaSourceId?.let { put("MediaSourceId", it) }
            audioIndex?.let { put("AudioStreamIndex", it) }
            put("SubtitleStreamIndex", subtitleIndex ?: -1)
            put("EnableDirectPlay", !forceStream)
            put("EnableDirectStream", !forceStream)
            put("EnableTranscoding", true)
            put("AllowVideoStreamCopy", true)
            put("AllowAudioStreamCopy", true)
            put("AutoOpenLiveStream", true)
        }.toString()
        return post("/Items/$itemId/PlaybackInfo?$q", body)
    }

    /** Where to stream from: the original file when the TV can play it, otherwise the server's converted stream. */
    fun streamUrl(itemId: String, src: MediaSource, playSessionId: String?): Pair<String, Boolean> {
        val t = token.orEmpty()
        if (src.SupportsDirectPlay || (src.SupportsDirectStream && src.TranscodingUrl == null)) {
            val q = "static=true&mediaSourceId=${src.Id}&deviceId=$deviceId&api_key=$t" + (playSessionId?.let { "&playSessionId=$it" } ?: "")
            return "$server/Videos/$itemId/stream?$q" to false
        }
        val tx = src.TranscodingUrl ?: throw ApiException(0, "The server didn’t offer a way to play this file.")
        val sep = if (tx.contains('?')) "&" else "?"
        return "$server$tx${if (tx.contains("api_key")) "" else "${sep}api_key=$t"}" to true
    }

    fun subtitleUrl(path: String): String = "$server$path${if (path.contains('?')) "&" else "?"}api_key=${token.orEmpty()}"

    suspend fun reportStart(report: JsonObject) = runCatching { call("POST", "/Sessions/Playing", report.toString()) }
    suspend fun reportProgress(report: JsonObject) = runCatching { call("POST", "/Sessions/Playing/Progress", report.toString()) }
    suspend fun reportStopped(report: JsonObject) = runCatching { call("POST", "/Sessions/Playing/Stopped", report.toString()) }
    suspend fun stopEncoding(playSessionId: String) = runCatching { call("DELETE", "/Videos/ActiveEncodings?deviceId=$deviceId&playSessionId=$playSessionId") }

    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")
}
