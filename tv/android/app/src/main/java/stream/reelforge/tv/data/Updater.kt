package stream.reelforge.tv.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.Request
import java.io.File

/**
 * Keeps the TV app up to date: checks the latest ReelForge release on GitHub for a newer TV app,
 * downloads it and hands it to Android's installer.
 */
class Updater(private val context: Context, private val currentVersion: String) {
    @Serializable
    private data class Release(val tag_name: String, val assets: List<Asset> = emptyList(), val draft: Boolean = false, val prerelease: Boolean = false)

    @Serializable
    private data class Asset(val name: String, val browser_download_url: String, val size: Long = 0)

    data class Update(val version: String, val url: String, val size: Long)

    companion object {
        const val RELEASES = "https://api.github.com/repos/ReelForge-stream/ReelForge/releases/latest"

        /** "0.10.2" > "0.9.9"; dev builds never auto-update. */
        fun isNewer(candidate: String, current: String): Boolean {
            if (current.endsWith("-dev")) return false
            fun parts(v: String) = v.removePrefix("v").split("-")[0].split(".").map { it.toIntOrNull() ?: 0 } + listOf(0, 0, 0)
            val a = parts(candidate)
            val b = parts(current)
            for (i in 0 until 3) if (a[i] != b[i]) return a[i] > b[i]
            return false
        }
    }

    suspend fun check(): Update? = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url(RELEASES).header("Accept", "application/vnd.github+json").build()
            JellyfinApi.defaultClient.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return@runCatching null
                val r = json.decodeFromString<Release>(res.body!!.string())
                val apk = r.assets.firstOrNull { it.name.endsWith(".apk") && it.name.contains("AndroidTV", ignoreCase = true) } ?: return@runCatching null
                val v = r.tag_name.removePrefix("v")
                if (isNewer(v, currentVersion)) Update(v, apk.browser_download_url, apk.size) else null
            }
        }.getOrNull()
    }

    /** True when Android lets ReelForge install apps (the TV asks the first time). */
    fun canInstall(): Boolean = Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()

    fun openInstallPermission() {
        if (Build.VERSION.SDK_INT >= 26) {
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }

    suspend fun downloadAndInstall(u: Update, onProgress: (Float) -> Unit) {
        val file = withContext(Dispatchers.IO) {
            val dir = File(context.cacheDir, "updates").apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }
            val out = File(dir, "ReelForge-AndroidTV-${u.version}.apk")
            JellyfinApi.defaultClient.newCall(Request.Builder().url(u.url).build()).execute().use { res ->
                if (!res.isSuccessful) throw ApiException(res.code, "Download failed (${res.code})")
                val body = res.body!!
                val total = body.contentLength().takeIf { it > 0 } ?: u.size
                body.byteStream().use { input ->
                    out.outputStream().use { output ->
                        val buf = ByteArray(64 * 1024)
                        var done = 0L
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            output.write(buf, 0, n)
                            done += n
                            if (total > 0) onProgress(done.toFloat() / total)
                        }
                    }
                }
            }
            out
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        context.startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}
