package app.downlink.android

import java.net.URI

data class DownloadOptions(val url: String, val format: String = "mp4", val quality: String = "1080", val item: Int = 1, val videoId: String? = null) {
    init {
        require(url == extractUrl(url)) { "Pega un enlace HTTP o HTTPS válido." }
        require(format in listOf("mp4", "mp3")) { "Formato no válido." }
        require(if (format == "mp4") quality in videoQualities else quality in audioQualities) { "Calidad no válida." }
        require(item in 1..100) { "Elemento no válido." }
        require(videoId == null || videoId.matches(Regex("[A-Za-z0-9_-]{1,160}"))) { "Identificador de vídeo no válido." }
    }

    fun arguments(output: String): List<String> = buildList {
        addAll(listOf("--no-playlist", "--no-mtime", "--newline", "-o", output))
        if (videoId == null) addAll(listOf("--playlist-items", item.toString()))
        else addAll(listOf("--playlist-end", "100"))
        addAll(listOf("--match-filters", if (videoId == null) "!is_live" else "!is_live & id = '$videoId'"))
        if (format == "mp3") {
            addAll(listOf("-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "${quality}K"))
        } else {
            // Match the shorter dimension for portrait video as well as landscape video.
            // Keep a combined-stream fallback for direct media with unknown dimensions.
            val limit = if (quality == "best") "" else "[height<=?${quality}]"
            val portrait = if (quality == "best") "" else "[width<=?${quality}]"
            val selector = if (quality == "best") "bv*+ba/b" else
                "bv*$limit+ba/bv*$portrait+ba/b$limit/b$portrait"
            addAll(listOf("-f", selector, "-S", "vcodec:h264,acodec:aac",
                "--merge-output-format", "mp4", "--recode-video", "mp4"))
        }
    }

    companion object {
        val videoQualities = listOf("best", "4320", "2160", "1440", "1080", "720", "480", "360", "240", "144")
        val audioQualities = listOf("320", "256", "224", "192", "160", "128", "96", "80", "64", "48")
        fun extractUrl(text: String): String? {
            val trimmed = text.trim()
            if (trimmed.matches(Regex("@[A-Za-z0-9._]{1,30}"))) return "https://www.instagram.com/stories/${trimmed.drop(1)}/"
            val found = Regex("https?://[^\\s<>\"\\u0000-\\u001f]+", RegexOption.IGNORE_CASE)
                .find(trimmed)?.value?.trimEnd('.', ',', ')', ']', ';') ?: return null
            return try {
                val uri = URI(found)
                if (uri.host.isNullOrBlank() || uri.rawUserInfo != null || uri.port !in -1..65535) null
                else if (isInstagram(found) && uri.path.matches(Regex("/[A-Za-z0-9._]{1,30}/?")) && uri.path.trim('/') !in setOf("explore", "accounts", "direct", "reels", "stories"))
                    "https://www.instagram.com/stories/${uri.path.trim('/')}/"
                else found
            } catch (_: Exception) { null }
        }
        fun isInstagram(url: String): Boolean = try {
            val host = URI(url).host.orEmpty().lowercase()
            host == "instagram.com" || host.endsWith(".instagram.com")
        } catch (_: Exception) { false }
        fun platform(url: String): String {
            val host = try { URI(url).host.orEmpty().lowercase().removePrefix("www.") } catch (_: Exception) { "" }
            return when {
                host == "youtu.be" || host == "youtube.com" || host.endsWith(".youtube.com") -> "YouTube"
                isInstagram(url) -> "Instagram"
                host == "tiktok.com" || host.endsWith(".tiktok.com") -> "TikTok"
                host in listOf("x.com", "twitter.com") -> "X"
                host == "reddit.com" || host.endsWith(".reddit.com") || host == "redd.it" -> "Reddit"
                host == "twitch.tv" || host.endsWith(".twitch.tv") -> "Twitch"
                else -> host
            }
        }
    }
}
