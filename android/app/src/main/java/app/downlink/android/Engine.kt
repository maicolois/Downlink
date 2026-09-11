package app.downlink.android

import android.content.Context
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

data class MediaInfo(val title: String, val uploader: String, val duration: Long, val item: Int, val isLive: Boolean = false, val id: String? = null, val hasAudio: Boolean = true, val thumbnailUrl: String = "")

object Engine {
    private val lock = ReentrantLock(true)
    @Volatile private var initialized = false
    @Volatile private var activeProcessId: String? = null
    const val bundledVersion = "2026.08.19"
    fun init(context: Context) = lock.withLock {
        if (!initialized) {
            YoutubeDL.init(context.applicationContext)
            FFmpeg.getInstance().init(context.applicationContext)
            initialized = true
        }
    }
    fun version(context: Context) = YoutubeDL.version(context) ?: bundledVersion
    fun update(context: Context): String = lock.withLock {
        init(context)
        YoutubeDL.updateYoutubeDL(context, YoutubeDL.UpdateChannel.STABLE)
        version(context)
    }
    private fun base(url: String): YoutubeDLRequest = YoutubeDLRequest(url)
        .addOption("--ignore-config").addOption("--no-cache-dir")
        .addOption("--socket-timeout", "20").addOption("--retries", "2")
        .addOption("--extractor-retries", "2").addOption("--fragment-retries", "2")
        .addOption("--no-warnings")

    fun inspect(context: Context, url: String): List<MediaInfo> = lock.withLock {
        init(context)
        val cookie = InstagramSession.cookieFile(context, url)
        try {
            val request = base(url).addOption("--dump-single-json").addOption("--skip-download")
                .addOption("--no-playlist").addOption("--playlist-end", "100")
            cookie?.let { request.addOption("--cookies", it.absolutePath) }
            val json = JSONObject(YoutubeDL.execute(request, "inspect").out.trim())
            val entries = json.optJSONArray("entries")
            fun hasAudio(j: JSONObject): Boolean {
                val formats = j.optJSONArray("formats") ?: return j.optString("acodec") != "none"
                return (0 until formats.length()).any { formats.optJSONObject(it)?.optString("acodec") != "none" }
            }
            fun parse(j: JSONObject, item: Int) = MediaInfo(j.optString("title", "Vídeo"),
                j.optString("uploader", j.optString("channel", "")), j.optDouble("duration", 0.0).toLong(),
                j.optInt("playlist_index", item), j.optBoolean("is_live", false),
                j.optString("id").takeIf { it.matches(Regex("[A-Za-z0-9_-]{1,160}")) }, hasAudio(j), thumbnailUrl(j))
            if (entries == null) listOf(parse(json, 1)) else (0 until entries.length()).mapNotNull { i ->
                entries.optJSONObject(i)?.takeIf {
                    it.optString("vcodec") != "none" || it.optJSONArray("formats") != null
                }?.let { parse(it, i + 1) }
            }.also { require(it.isNotEmpty()) { "No hay vídeos accesibles en este enlace." } }
        } finally { cookie?.delete() }
    }

    fun download(context: Context, job: DownloadJob, directory: File, cancelled: AtomicBoolean,
                 progress: (Int, String) -> Unit): File = lock.withLock {
        check(!cancelled.get()) { "Cancelado" }
        init(context)
        check(!cancelled.get()) { "Cancelado" }
        if (job.authenticated && !InstagramSession.connected(context)) error("La sesión de Instagram ha caducado. Conecta tu cuenta de nuevo.")
        directory.mkdirs()
        val cookie = if (job.authenticated) InstagramSession.cookieFile(context, job.options.url) else null
        activeProcessId = job.id
        try {
            val request = base(job.options.url)
                .addCommands(job.options.arguments(File(directory, "%(title).160B [%(id)s].%(ext)s").absolutePath))
                .addOption("--write-info-json")
            cookie?.let { request.addOption("--cookies", it.absolutePath) }
            YoutubeDL.execute(request, job.id) { amount, eta, line ->
                if (cancelled.get()) cancel(context, job.id)
                val detail = when {
                    line.contains("[ExtractAudio]") || line.contains("[VideoConvertor]") -> "Convirtiendo a ${job.options.format.uppercase()}…"
                    line.contains("[Merger]") -> "Uniendo vídeo y audio…"
                    amount >= 0 && eta > 0 -> "${amount.toInt()}% · ${eta}s restantes"
                    amount >= 0 -> "${amount.toInt()}% · Procesando…"
                    else -> "Preparando descarga…"
                }
                progress(amount.toInt().coerceIn(0, 99), detail)
            }
            check(!cancelled.get()) { "Cancelado" }
            // The download itself provides metadata even when the user skips analysis.
            runCatching {
                val metadataFile = directory.listFiles()?.firstOrNull { it.name.endsWith(".info.json") }
                metadataFile?.let {
                    val metadata = JSONObject(it.readText())
                    DownloadStore.update(job.id) { current -> current.copy(
                        title = metadata.optString("title").ifBlank { current.title },
                        thumbnailUrl = thumbnailUrl(metadata).ifBlank { current.thumbnailUrl }) }
                }
            }
            directory.listFiles()?.filter { it.extension == job.options.format && it.length() > 0 }
                ?.singleOrNull() ?: error("No se generó un archivo ${job.options.format.uppercase()}. Comprueba que el enlace contiene vídeo o audio y no una emisión en directo.")
        } finally { activeProcessId = null; cookie?.delete() }
    }

    internal fun thumbnailUrl(json: JSONObject): String {
        Thumbnails.webUrl(json.optString("thumbnail"))?.let { return it }
        val images = json.optJSONArray("thumbnails") ?: return ""
        return (images.length() - 1 downTo 0).firstNotNullOfOrNull {
            Thumbnails.webUrl(images.optJSONObject(it)?.optString("url").orEmpty())
        }.orEmpty()
    }

    fun cancel(context: Context, id: String) {
        if (activeProcessId != id) return
        YoutubeDL.destroyProcessById(id)
        // The wrapper does not reliably stop FFmpeg children on Android. Only touch this
        // app's own native media processes; all extraction is serialized by the lock above.
        val nativeDir = context.applicationInfo.nativeLibraryDir + "/"
        File("/proc").listFiles()?.forEach { proc ->
            val pid = proc.name.toIntOrNull() ?: return@forEach
            runCatching {
                val status = File(proc, "status").readText()
                val uid = Regex("(?m)^Uid:\\s+(\\d+)").find(status)?.groupValues?.get(1)?.toInt()
                if (uid != android.os.Process.myUid()) return@runCatching
                val executable = File(proc, "cmdline").readText().substringBefore('\u0000')
                if (executable in listOf("libpython.so", "libffmpeg.so", "libffprobe.so", "libqjs.so").map { nativeDir + it }) {
                    android.os.Process.killProcess(pid)
                }
            }
        }
    }

    fun friendlyError(error: Throwable): String {
        val raw = error.message.orEmpty()
        val hint = when {
            raw.contains("sign in", true) || raw.contains("login", true) || raw.contains("cookies", true) ->
                "El sitio requiere una sesión o ha limitado este enlace. En Instagram, conecta tu cuenta en Ajustes."
            raw.contains("Unsupported URL", true) -> "Este enlace no está admitido. Comparte el enlace del vídeo o publicación."
            raw.contains("Requested format", true) -> "Esa calidad no está disponible. Prueba Mejor disponible."
            raw.contains("network", true) || raw.contains("resolve", true) || raw.contains("timed out", true) -> "No se pudo conectar. Comprueba Internet e inténtalo de nuevo."
            raw.contains("No space", true) || raw.contains("ENOSPC", true) -> "No queda espacio. Libera almacenamiento y reintenta."
            else -> "No se pudo completar. Comprueba el enlace o actualiza el motor en Ajustes."
        }
        val detail = raw.lineSequence().filter { it.isNotBlank() }.lastOrNull()?.take(500).orEmpty()
        return if (detail.isBlank()) hint else "$hint\n\n$detail"
    }
}
