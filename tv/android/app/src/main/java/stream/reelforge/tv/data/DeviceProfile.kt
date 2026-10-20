package stream.reelforge.tv.data

import android.content.Context
import android.media.MediaCodecList
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioCapabilities
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * Tells the server what this TV can play itself, so files go straight through untouched (4K, HDR,
 * Dolby/DTS surround via the receiver) and only what the TV can't handle gets converted.
 */
object DeviceProfile {
    data class Caps(val video: List<String>, val audio: List<String>, val hevc: Boolean)

    @OptIn(UnstableApi::class)
    fun detect(context: Context): Caps {
        val types = runCatching {
            MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos.filter { !it.isEncoder }.flatMap { it.supportedTypes.toList() }.map { it.lowercase() }.toSet()
        }.getOrDefault(emptySet())
        val video = buildList {
            add("h264")
            if ("video/hevc" in types) add("hevc")
            if ("video/x-vnd.on2.vp9" in types) add("vp9")
            if ("video/av01" in types) add("av1")
            if ("video/x-vnd.on2.vp8" in types) add("vp8")
            if ("video/mpeg2" in types) add("mpeg2video")
            if ("video/mp4v-es" in types) add("mpeg4")
        }
        val pass = runCatching { AudioCapabilities.getCapabilities(context) }.getOrNull()
        fun can(mime: String, encoding: Int) = mime in types || (pass?.supportsEncoding(encoding) == true)
        val audio = buildList {
            addAll(listOf("aac", "mp3", "mp2", "flac", "opus", "vorbis", "alac", "pcm_s16le", "pcm_s24le"))
            if (can("audio/ac3", C.ENCODING_AC3)) add("ac3")
            if (can("audio/eac3", C.ENCODING_E_AC3)) add("eac3")
            if (can("audio/vnd.dts", C.ENCODING_DTS)) { add("dts"); add("dca") }
            if (can("audio/vnd.dts.hd", C.ENCODING_DTS_HD)) add("dtshd")
            if (can("audio/true-hd", C.ENCODING_DOLBY_TRUEHD)) add("truehd")
        }
        return Caps(video, audio, "hevc" in video)
    }

    fun build(caps: Caps, maxBitrate: Long): JsonObject = buildJsonObject {
        put("Name", "ReelForge Android TV")
        put("MaxStreamingBitrate", maxBitrate)
        put("MaxStaticBitrate", maxBitrate)
        put("MusicStreamingTranscodingBitrate", 320_000)
        putJsonArray("DirectPlayProfiles") {
            addJsonObject {
                put("Container", "mkv,webm,mp4,m4v,mov,ts,m2ts,mpegts")
                put("Type", "Video")
                put("VideoCodec", caps.video.joinToString(","))
                put("AudioCodec", caps.audio.joinToString(","))
            }
            addJsonObject { put("Container", "mp3,aac,flac,ogg,opus,m4a,wav"); put("Type", "Audio") }
        }
        putJsonArray("TranscodingProfiles") {
            addJsonObject {
                put("Container", "ts")
                put("Type", "Video")
                put("VideoCodec", if (caps.hevc) "hevc,h264" else "h264")
                put("AudioCodec", caps.audio.filter { it in listOf("aac", "mp3", "ac3", "eac3") }.joinToString(","))
                put("Context", "Streaming")
                put("Protocol", "hls")
                put("MaxAudioChannels", "6")
                put("MinSegments", "1")
                put("BreakOnNonKeyFrames", true)
            }
            addJsonObject { put("Container", "mp3"); put("Type", "Audio"); put("AudioCodec", "mp3"); put("Context", "Streaming"); put("Protocol", "http") }
        }
        putJsonArray("ContainerProfiles") {}
        putJsonArray("CodecProfiles") {}
        // Subtitles inside the file are shown by the player; separate files are fetched as text;
        // anything else is drawn into the picture by the server.
        putJsonArray("SubtitleProfiles") {
            for (f in listOf("srt", "subrip", "ass", "ssa", "vtt", "webvtt", "pgssub", "dvdsub", "dvbsub", "mov_text")) addJsonObject { put("Format", f); put("Method", "Embed") }
            for (f in listOf("srt", "subrip", "vtt", "ass", "ssa")) addJsonObject { put("Format", f); put("Method", "External") }
        }
    }
}
