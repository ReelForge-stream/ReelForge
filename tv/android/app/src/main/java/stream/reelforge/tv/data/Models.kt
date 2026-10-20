@file:Suppress("PropertyName")

package stream.reelforge.tv.data

import kotlinx.serialization.Serializable

// Server records, named exactly as the server sends them.

@Serializable
data class PublicInfo(val ServerName: String = "", val Version: String = "", val Id: String = "", val StartupWizardCompleted: Boolean = true)

@Serializable
data class User(
    val Id: String,
    val Name: String,
    val HasPassword: Boolean = false,
    val PrimaryImageTag: String? = null,
    val Policy: UserPolicy? = null,
)

@Serializable
data class UserPolicy(val IsAdministrator: Boolean = false)

@Serializable
data class AuthResult(val AccessToken: String, val User: User, val ServerId: String = "")

@Serializable
data class UserData(
    val PlayedPercentage: Double? = null,
    val PlaybackPositionTicks: Long = 0,
    val Played: Boolean = false,
    val IsFavorite: Boolean = false,
    val UnplayedItemCount: Int? = null,
)

@Serializable
data class Item(
    val Id: String,
    val Name: String = "",
    val Type: String = "",
    val CollectionType: String? = null,
    val Overview: String? = null,
    val ProductionYear: Int? = null,
    val OfficialRating: String? = null,
    val CommunityRating: Double? = null,
    val RunTimeTicks: Long? = null,
    val Genres: List<String>? = null,
    val SortName: String? = null,
    val OriginalTitle: String? = null,
    val SeriesId: String? = null,
    val SeriesName: String? = null,
    val SeasonId: String? = null,
    val IndexNumber: Int? = null,
    val ParentIndexNumber: Int? = null,
    val ChildCount: Int? = null,
    val ImageTags: Map<String, String>? = null,
    val BackdropImageTags: List<String>? = null,
    val ParentBackdropItemId: String? = null,
    val ParentBackdropImageTags: List<String>? = null,
    val ParentLogoItemId: String? = null,
    val ParentLogoImageTag: String? = null,
    val ParentThumbItemId: String? = null,
    val ParentThumbImageTag: String? = null,
    val SeriesPrimaryImageTag: String? = null,
    val UserData: UserData? = null,
    val People: List<Person>? = null,
    val Studios: List<NameRef>? = null,
    val MediaSources: List<MediaSource>? = null,
    val Taglines: List<String>? = null,
    val DateCreated: String? = null,
) {
    val isSeries get() = Type == "Series"
    val isEpisode get() = Type == "Episode"
    val isPlayable get() = Type == "Movie" || Type == "Episode" || Type == "Video"

    /** "S1:E4" style code for episodes. */
    val episodeCode: String
        get() = if (ParentIndexNumber != null && IndexNumber != null) "S$ParentIndexNumber:E$IndexNumber" else ""

    val runtimeMinutes: Int? get() = RunTimeTicks?.let { (it / 600_000_000L).toInt() }?.takeIf { it > 0 }
}

@Serializable
data class Person(val Name: String, val Role: String? = null, val Type: String = "")

@Serializable
data class NameRef(val Name: String, val Id: String? = null)

@Serializable
data class ItemsResult(val Items: List<Item> = emptyList(), val TotalRecordCount: Int = 0)

@Serializable
data class MediaStream(
    val Index: Int,
    val Type: String,
    val Codec: String? = null,
    val Language: String? = null,
    val DisplayTitle: String? = null,
    val Title: String? = null,
    val IsDefault: Boolean = false,
    val IsForced: Boolean = false,
    val IsExternal: Boolean = false,
    val IsTextSubtitleStream: Boolean = false,
    val DeliveryMethod: String? = null,
    val DeliveryUrl: String? = null,
    val Height: Int? = null,
    val Width: Int? = null,
    val Channels: Int? = null,
    val ChannelLayout: String? = null,
    val VideoRangeType: String? = null,
)

@Serializable
data class MediaSource(
    val Id: String,
    val Container: String? = null,
    val Path: String? = null,
    val Size: Long? = null,
    val Bitrate: Long? = null,
    val SupportsDirectPlay: Boolean = false,
    val SupportsDirectStream: Boolean = false,
    val SupportsTranscoding: Boolean = false,
    val TranscodingUrl: String? = null,
    val MediaStreams: List<MediaStream> = emptyList(),
    val DefaultAudioStreamIndex: Int? = null,
    val DefaultSubtitleStreamIndex: Int? = null,
)

@Serializable
data class PlaybackInfo(val MediaSources: List<MediaSource> = emptyList(), val PlaySessionId: String? = null, val ErrorCode: String? = null)

/** A server found on the home network. */
@Serializable
data class DiscoveredServer(val Address: String, val Id: String = "", val Name: String = "")

/** Everything needed to talk to the server as one profile. */
data class Session(val server: String, val token: String, val userId: String, val userName: String, val isAdmin: Boolean, val imageTag: String?)
