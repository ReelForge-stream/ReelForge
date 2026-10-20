package stream.reelforge.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

/**
 * Finds ReelForge servers on the home network. Servers answer a UDP broadcast on port 7359
 * (the same discovery the Jellyfin engine uses), so the TV can list them without typing an address.
 */
object Discovery {
    private const val PORT = 7359
    private val QUESTION = "who is JellyfinServer?".toByteArray()

    suspend fun find(timeoutMs: Int = 2500): List<DiscoveredServer> = withContext(Dispatchers.IO) {
        val found = linkedMapOf<String, DiscoveredServer>()
        runCatching {
            DatagramSocket().use { socket ->
                socket.broadcast = true
                socket.soTimeout = 400
                val target = InetAddress.getByName("255.255.255.255")
                repeat(2) { socket.send(DatagramPacket(QUESTION, QUESTION.size, target, PORT)) }
                val buf = ByteArray(4096)
                val until = System.currentTimeMillis() + timeoutMs
                while (System.currentTimeMillis() < until) {
                    val packet = DatagramPacket(buf, buf.size)
                    try {
                        socket.receive(packet)
                    } catch (_: SocketTimeoutException) {
                        continue
                    }
                    parse(String(packet.data, 0, packet.length))?.let { s -> found.putIfAbsent(s.Id.ifEmpty { s.Address }, s) }
                }
            }
        }
        found.values.toList()
    }

    fun parse(reply: String): DiscoveredServer? = runCatching { json.decodeFromString<DiscoveredServer>(reply) }.getOrNull()?.takeIf { it.Address.isNotBlank() }
}
