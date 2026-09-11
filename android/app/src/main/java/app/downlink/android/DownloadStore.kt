package app.downlink.android

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.CopyOnWriteArraySet

data class DownloadJob(
    val id: String = UUID.randomUUID().toString(),
    val options: DownloadOptions,
    val title: String,
    val authenticated: Boolean = false,
    val created: Long = System.currentTimeMillis(),
    val state: String = "queued",
    val progress: Int = 0,
    val detail: String = "En cola",
    val uri: String = "",
    val filename: String = "",
    val size: Long = 0,
    val thumbnailUrl: String = ""
) {
    val terminal: Boolean get() = state in listOf("done", "error", "cancelled")
    fun json() = JSONObject().put("id", id).put("url", options.url).put("format", options.format)
        .put("quality", options.quality).put("item", options.item).put("videoId", options.videoId).put("title", title)
        .put("authenticated", authenticated).put("created", created).put("state", state)
        .put("progress", progress).put("detail", detail).put("uri", uri).put("filename", filename).put("size", size).put("thumbnailUrl", thumbnailUrl)
    companion object {
        fun fromJson(j: JSONObject) = DownloadJob(j.getString("id"),
            DownloadOptions(j.getString("url"), j.getString("format"), j.getString("quality"), j.optInt("item", 1), j.optString("videoId").takeIf { it.isNotBlank() }),
            j.getString("title"), j.optBoolean("authenticated"), j.getLong("created"), j.getString("state"),
            j.optInt("progress"), j.optString("detail"), j.optString("uri"), j.optString("filename"), j.optLong("size"), j.optString("thumbnailUrl"))
    }
}

object DownloadStore {
    private lateinit var context: Context
    private val jobs = LinkedHashMap<String, DownloadJob>()
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    private val main = Handler(Looper.getMainLooper())
    @Synchronized fun init(appContext: Context) {
        context = appContext.applicationContext
        val saved = runCatching { JSONArray(prefs().getString("jobs", "[]")) }.getOrDefault(JSONArray())
        for (i in 0 until saved.length()) runCatching {
            var job = DownloadJob.fromJson(saved.getJSONObject(i))
            if (!job.terminal) job = job.copy(state = "error", detail = "Descarga interrumpida al cerrar Android. Pulsa Reintentar.")
            jobs[job.id] = job
        }
        // Pending MediaStore rows are tracked before copying, so process death cannot leave ghost files.
        prefs().getStringSet("pendingUris", emptySet())!!.forEach { uri ->
            runCatching { context.contentResolver.delete(Uri.parse(uri), null, null) }
        }
        prefs().edit().remove("pendingUris").apply()
        java.io.File(context.cacheDir, "downloads").deleteRecursively()
        context.cacheDir.listFiles()?.filter { it.name.startsWith("instagram-") && it.extension == "txt" }?.forEach { it.delete() }
        persist()
    }
    private fun prefs() = context.getSharedPreferences("downloads", Context.MODE_PRIVATE)
    @Synchronized fun all(): List<DownloadJob> = jobs.values.toList().reversed()
    @Synchronized fun get(id: String): DownloadJob? = jobs[id]
    @Synchronized fun next(): DownloadJob? = jobs.values.firstOrNull { it.state == "queued" }
    @Synchronized fun claimNext(): DownloadJob? {
        val next = next() ?: return null
        val claimed = next.copy(state = "running", detail = "Preparando descarga…")
        jobs[next.id] = claimed
        changed()
        return claimed
    }
    @Synchronized fun add(options: DownloadOptions, title: String, thumbnailUrl: String = ""): DownloadJob {
        val job = DownloadJob(options = options, title = title.ifBlank { DownloadOptions.platform(options.url) },
            authenticated = DownloadOptions.isInstagram(options.url) && InstagramSession.connected(context), thumbnailUrl = thumbnailUrl)
        jobs[job.id] = job
        changed()
        return job
    }
    @Synchronized fun update(id: String, transform: (DownloadJob) -> DownloadJob) {
        jobs[id]?.let { jobs[id] = transform(it); changed() }
    }
    @Synchronized fun remove(id: String) {
        if (jobs[id]?.terminal == true) { jobs.remove(id); Thumbnails.removeJob(context, id); changed() }
    }
    @Synchronized fun pending(uri: Uri, add: Boolean) {
        val set = prefs().getStringSet("pendingUris", emptySet())!!.toMutableSet()
        if (add) set.add(uri.toString()) else set.remove(uri.toString())
        prefs().edit().putStringSet("pendingUris", set).commit()
    }
    @Synchronized fun complete(id: String, uri: Uri, filename: String, size: Long) {
        jobs[id]?.let { jobs[id] = it.copy(state = "done", progress = 100, detail = "Guardado en Download/Downlink", uri = uri.toString(), filename = filename, size = size) }
        val pending = prefs().getStringSet("pendingUris", emptySet())!!.toMutableSet().apply { remove(uri.toString()) }
        val array = JSONArray().apply { jobs.values.forEach { put(it.json()) } }
        prefs().edit().putString("jobs", array.toString()).putStringSet("pendingUris", pending).commit()
        main.post { listeners.forEach { it() } }
    }
    fun observe(listener: () -> Unit) { listeners.add(listener); listener() }
    fun unobserve(listener: () -> Unit) { listeners.remove(listener) }
    private fun changed() { persist(); main.post { listeners.forEach { it() } } }
    private fun persist() {
        val array = JSONArray()
        jobs.values.forEach { array.put(it.json()) }
        prefs().edit().putString("jobs", array.toString()).apply()
    }
}
