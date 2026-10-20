package stream.reelforge.tv.data

import java.text.Normalizer

/**
 * Forgiving title matching for search as you type (same rules as the web app): prefixes, any word,
 * initials ("lotr"), typos ("breking bad"), dropped letters ("brkng") and missing punctuation.
 */
object Fuzzy {
    private val articles = setOf("the", "a", "an")

    fun normalize(s: String): String =
        Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").lowercase()
            .replace("&", " and ").replace(Regex("['’]"), "").replace(Regex("[^a-z0-9]+"), " ").trim()

    fun editDistance(a: String, b: String, max: Int): Int {
        if (kotlin.math.abs(a.length - b.length) > max) return max + 1
        var prev2 = IntArray(b.length + 1)
        var prev = IntArray(b.length + 1) { it }
        var cur = IntArray(b.length + 1)
        for (i in 1..a.length) {
            cur[0] = i
            var best = i
            for (j in 1..b.length) {
                var v = minOf(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
                if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) v = minOf(v, prev2[j - 2] + 1)
                cur[j] = v
                if (v < best) best = v
            }
            if (best > max) return max + 1
            val t = prev2; prev2 = prev; prev = cur; cur = t
        }
        return prev[b.length]
    }

    private fun allowance(len: Int) = if (len <= 3) 0 else if (len <= 6) 1 else 2

    private fun isSubsequence(q: String, t: String): Boolean {
        var i = 0
        for (c in t) if (i < q.length && c == q[i]) i++
        return i == q.length
    }

    private fun fuzzyPrefix(word: String, target: String): Int {
        if (target.startsWith(word)) return 0
        val skipped = word.length >= 3 && word[0] == target.firstOrNull() && isSubsequence(word, target.take(word.length * 2))
        val max = allowance(word.length)
        if (max == 0) return if (skipped) 1 else -1
        var best = max + 1
        for (len in maxOf(1, word.length - max)..minOf(target.length, word.length + max)) {
            best = minOf(best, editDistance(word, target.take(len), max))
            if (best == 0) break
        }
        return if (best <= max) best else if (skipped) max else -1
    }

    private fun initials(words: List<String>) = words.joinToString("") { w -> if (w.all { it.isDigit() }) w else w.take(1) }

    private class Prepared(val t: String, val words: List<String>, val tNoArticle: String, val ts: String, val ini: String, val iniSig: String)

    private val cache = HashMap<String, Prepared>()

    private fun prepare(raw: String): Prepared = cache.getOrPut(raw) {
        val t = normalize(raw)
        val words = t.split(' ').filter { it.isNotEmpty() }
        val sig = words.filter { it !in articles }
        val tNo = sig.joinToString(" ")
        Prepared(t, words, tNo, tNo.replace(" ", ""), initials(words), initials(sig))
    }

    fun score(query: String, names: List<String?>): Int {
        val q = normalize(query)
        if (q.isEmpty()) return 0
        val qWords = q.split(' ')
        val qs = q.replace(" ", "")
        var best = 0
        for (raw in names) {
            if (raw.isNullOrBlank()) continue
            val p = prepare(raw)
            if (p.t.isEmpty()) continue
            var s = 0
            if (p.t == q || p.tNoArticle == q) s = 1000
            else if (p.t.startsWith(q) || p.tNoArticle.startsWith(q)) s = 900 - minOf(100, p.t.length - q.length)
            else {
                var wi = 0
                var typos = 0
                var ok = true
                for (qw in qWords) {
                    var found = false
                    while (wi < p.words.size) {
                        val used = fuzzyPrefix(qw, p.words[wi++])
                        if (used >= 0) { typos += used; found = true; break }
                    }
                    if (!found) { ok = false; break }
                }
                if (ok) s = (if (typos > 0) 640 else 800) - typos * 40 - minOf(60, p.words.size * 4)
                else if (p.t.contains(q)) s = 700
                else if (q.length >= 2 && qWords.size == 1 && (p.ini == q || p.iniSig == q)) s = 680
                else if (q.length >= 2 && qWords.size == 1 && (p.ini.startsWith(q) || p.iniSig.startsWith(q))) s = 560
                else {
                    val max = allowance(qs.length)
                    if (max > 0 && p.ts.length >= qs.length - max) {
                        var d = editDistance(qs, p.ts, max)
                        for (len in maxOf(1, qs.length - max)..minOf(p.ts.length, qs.length + max)) d = minOf(d, editDistance(qs, p.ts.take(len), max))
                        if (d <= max) s = 600 - d * 60
                    }
                    if (s == 0 && qs.length >= 4 && isSubsequence(qs, p.ts)) s = 300
                }
            }
            best = maxOf(best, s)
        }
        return best
    }

    /** Best matches first; far-fetched ones dropped when there are good matches. */
    fun search(query: String, items: List<Item>, limit: Int): List<Item> {
        val ranked = items.mapNotNull { i ->
            val s = score(query, listOf(i.Name, i.OriginalTitle?.takeIf { it != i.Name }))
            if (s > 0) i to s else null
        }.sortedWith(compareByDescending<Pair<Item, Int>> { it.second }.thenByDescending { it.first.CommunityRating ?: 0.0 }.thenByDescending { it.first.ProductionYear ?: 0 })
        val top = ranked.firstOrNull()?.second ?: 0
        val floor = when { top >= 850 -> 650; top >= 700 -> 560; top >= 500 -> 300; else -> 0 }
        return ranked.filter { it.second >= floor }.take(limit).map { it.first }
    }
}
