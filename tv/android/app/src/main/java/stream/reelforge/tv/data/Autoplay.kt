package stream.reelforge.tv.data

import android.content.Context

/**
 * Autoplay the next episode, but stop and ask "Still watching?" after a few in a row
 * played with nobody pressing a button (so a sleeping viewer doesn't binge a season).
 * Same rules as the web player.
 */
object Autoplay {
    const val UP_NEXT_SECONDS = 15

    data class Prefs(val on: Boolean = true, val askAfter: Int = 2)

    enum class End { NEXT, ASK, STOP }

    fun atEnd(p: Prefs, autoPlayedSoFar: Int, hasNext: Boolean, dismissed: Boolean): End = when {
        !hasNext || !p.on || dismissed -> End.STOP
        p.askAfter > 0 && autoPlayedSoFar >= p.askAfter -> End.ASK
        else -> End.NEXT
    }

    fun showUpNext(p: Prefs, autoPlayedSoFar: Int, hasNext: Boolean, dismissed: Boolean, positionSec: Long, durationSec: Long): Boolean =
        durationSec >= 120 && positionSec > 0 &&
            atEnd(p, autoPlayedSoFar, hasNext, dismissed) == End.NEXT &&
            durationSec - positionSec <= UP_NEXT_SECONDS

    fun describe(p: Prefs): String = when {
        !p.on -> "Off"
        p.askAfter > 0 -> "On · asks after ${p.askAfter}"
        else -> "On"
    }

    private fun prefs(c: Context) = c.getSharedPreferences("reelforge", Context.MODE_PRIVATE)

    fun load(c: Context) = prefs(c).let { Prefs(it.getBoolean("autoplay_on", true), it.getInt("autoplay_ask_after", 2)) }

    fun save(c: Context, p: Prefs) = prefs(c).edit().putBoolean("autoplay_on", p.on).putInt("autoplay_ask_after", p.askAfter).apply()
}
