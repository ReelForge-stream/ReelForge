package stream.reelforge.tv

import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import stream.reelforge.tv.data.DeviceProfile
import stream.reelforge.tv.data.Discovery
import stream.reelforge.tv.data.Fuzzy
import stream.reelforge.tv.data.Item
import stream.reelforge.tv.data.JellyfinApi
import stream.reelforge.tv.data.Updater

class LogicTest {
    private val titles = listOf(
        "The Lord of the Rings: The Fellowship of the Ring", "Breaking Bad", "Better Call Saul", "The Matrix", "The Matrix Reloaded",
        "Spider-Man: No Way Home", "The Dark Knight", "Dark", "Pokémon Detective Pikachu", "Fast & Furious", "Harry Potter and the Sorcerer’s Stone", "Toy Story 3",
    ).mapIndexed { i, n -> Item(Id = "$i", Name = n) }

    private fun top(q: String) = Fuzzy.search(q, titles, 3).firstOrNull()?.Name

    @Test fun search_prefix_words_initials_typos() {
        assertEquals("The Matrix", top("matrix"))
        assertEquals("The Dark Knight", top("dark kn"))
        assertTrue(top("lotr")!!.startsWith("The Lord of the Rings"))
        assertEquals("Better Call Saul", top("bcs"))
        assertEquals("Breaking Bad", top("breking bad"))
        assertEquals("Breaking Bad", top("brkng"))
        assertEquals("Spider-Man: No Way Home", top("spiderman"))
        assertEquals("Pokémon Detective Pikachu", top("pokemon"))
        assertEquals("Fast & Furious", top("fast and"))
        assertEquals("Toy Story 3", top("toy story3"))
        assertNull(top("xylophone"))
    }

    @Test fun addresses_get_the_default_port() {
        assertEquals("http://192.168.1.20:8096", JellyfinApi.normalizeAddress("192.168.1.20"))
        assertEquals("http://media-pc:9000", JellyfinApi.normalizeAddress("media-pc:9000/"))
        assertEquals("https://reelforge.example.com", JellyfinApi.normalizeAddress("https://reelforge.example.com"))
        assertEquals("http://10.0.0.165:8096", JellyfinApi.normalizeAddress(" http://10.0.0.165:8096 "))
    }

    @Test fun update_versions_compare_numerically() {
        assertTrue(Updater.isNewer("0.10.0", "0.9.3"))
        assertTrue(Updater.isNewer("v1.0.0", "0.12.4"))
        assertFalse(Updater.isNewer("0.9.0", "0.9.0"))
        assertFalse(Updater.isNewer("0.8.9", "0.9.0"))
        assertFalse(Updater.isNewer("9.9.9", "0.0.0-dev"))
    }

    @Test fun discovery_replies_are_parsed() {
        val s = Discovery.parse("""{"Address":"http://10.0.0.165:8096","Id":"abc","Name":"MEDIA-PC","EndpointAddress":null}""")!!
        assertEquals("http://10.0.0.165:8096", s.Address)
        assertEquals("MEDIA-PC", s.Name)
        assertNull(Discovery.parse("garbage"))
    }

    @Test fun device_profile_lists_what_the_tv_plays() {
        val p = DeviceProfile.build(DeviceProfile.Caps(listOf("h264", "hevc"), listOf("aac", "ac3", "eac3"), true), 20_000_000)
        val direct = p["DirectPlayProfiles"]!!.jsonArray[0].jsonObject
        assertTrue(direct["Container"]!!.jsonPrimitive.content.contains("mkv"))
        assertEquals("h264,hevc", direct["VideoCodec"]!!.jsonPrimitive.content)
        val tx = p["TranscodingProfiles"]!!.jsonArray[0].jsonObject
        assertEquals("hls", tx["Protocol"]!!.jsonPrimitive.content)
        assertEquals("hevc,h264", tx["VideoCodec"]!!.jsonPrimitive.content)
        assertEquals("aac,ac3,eac3", tx["AudioCodec"]!!.jsonPrimitive.content)
    }
}
