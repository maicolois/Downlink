package app.downlink.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.LruCache
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import java.io.ByteArrayOutputStream
import java.io.File
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Small, app-private previews. Network access and decoding never run on the UI thread. */
object Thumbnails {
    private val executor = Executors.newFixedThreadPool(2)
    private val main = Handler(Looper.getMainLooper())
    private val memory = object : LruCache<String, Bitmap>(12 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    private val locks = ConcurrentHashMap<String, Any>()
    private val failures = ConcurrentHashMap<String, Long>()
    // Accessed only on the main thread. Weak view references do not retain activities.
    private val pending = mutableMapOf<String, MutableList<Pair<WeakReference<ImageView>, WeakReference<TextView>>>>()
    private const val MAX_BYTES = 6 * 1024 * 1024

    fun trimMemory() { memory.evictAll() }

    internal fun webUrl(value: String): String? = runCatching {
        val uri = URI(value)
        value.takeIf { it.length <= 8192 && uri.scheme?.lowercase() in listOf("http", "https") && !uri.host.isNullOrBlank() && uri.rawUserInfo == null }
    }.getOrNull()

    private fun key(job: DownloadJob?, url: String) = if (job == null) "preview:$url" else "job:${job.id}"
    private fun filename(key: String) = MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") { "%02x".format(it) } + ".jpg"
    private fun file(context: Context, key: String) = File(
        if (key.startsWith("job:")) File(context.noBackupFilesDir, "thumbnails") else File(context.cacheDir, "previews"), filename(key))

    fun bind(image: ImageView, placeholder: TextView, url: String = "", job: DownloadJob? = null) {
        val cacheKey = key(job, url)
        val requestKey = "$cacheKey|$url|${job?.uri.orEmpty()}"
        image.tag = requestKey
        memory.get(cacheKey)?.let { display(image, placeholder, it); return }
        placeholder.text = "Cargando vista previa…"
        val waiting = pending[requestKey]
        val views = WeakReference(image) to WeakReference(placeholder)
        if (waiting != null) { waiting.add(views); return }
        if ((failures[requestKey] ?: 0L) > System.currentTimeMillis() - 30_000) {
            display(image, placeholder, null); return
        }
        pending[requestKey] = mutableListOf(views)
        val appContext = image.context.applicationContext
        executor.execute {
            val bitmap = runCatching { load(appContext, cacheKey, url, job) }.getOrNull()
            if (bitmap == null) failures[requestKey] = System.currentTimeMillis()
            main.post {
                pending.remove(requestKey)?.forEach { (imageRef, textRef) ->
                    val target = imageRef.get(); val text = textRef.get()
                    if (target != null && text != null && target.tag == requestKey) display(target, text, bitmap)
                }
            }
        }
    }

    private fun display(image: ImageView, placeholder: TextView, bitmap: Bitmap?) {
        image.setImageBitmap(bitmap)
        image.visibility = if (bitmap == null) View.INVISIBLE else View.VISIBLE
        placeholder.text = "Sin vista previa"
        placeholder.visibility = if (bitmap == null) View.VISIBLE else View.GONE
    }

    fun prepareJob(context: Context, job: DownloadJob, media: File): Bitmap? =
        load(context.applicationContext, key(job, job.thumbnailUrl), job.thumbnailUrl, job, media)

    internal fun load(context: Context, cacheKey: String, url: String, job: DownloadJob? = null, media: File? = null): Bitmap? =
        synchronized(locks.getOrPut(cacheKey) { Any() }) {
            memory.get(cacheKey)?.let { return@synchronized it }
            val target = file(context, cacheKey)
            val cached = runCatching { if (target.isFile) decode(target.readBytes()) else null }.getOrNull()
            if (cached != null) { memory.put(cacheKey, cached); return@synchronized cached }
            // Reuse the preview already fetched during analysis before contacting the CDN again.
            val preview = if (job != null && url.isNotBlank()) runCatching {
                val previewKey = key(null, url)
                memory.get(previewKey) ?: file(context, previewKey).takeIf { it.isFile }?.let { decode(it.readBytes()) }
            }.getOrNull() else null
            val remote = preview ?: runCatching { webUrl(url)?.let { fetch(it) } }.getOrNull()
            val bitmap = remote ?: runCatching {
                when {
                    media != null -> frame { setDataSource(media.absolutePath) }
                    !job?.uri.isNullOrBlank() -> frame { setDataSource(context, Uri.parse(job!!.uri)) }
                    else -> null
                }
            }.getOrNull() ?: return@synchronized null
            if (job != null && DownloadStore.get(job.id) == null) return@synchronized bitmap
            target.parentFile!!.mkdirs()
            val temporary = File.createTempFile("thumbnail-", ".tmp", target.parentFile)
            try {
                temporary.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
                check(temporary.renameTo(target))
            } finally { temporary.delete() }
            memory.put(cacheKey, bitmap)
            if (job == null) trimPreviewCache(target.parentFile!!)
            bitmap
        }

    private fun fetch(initialUrl: String): Bitmap? {
        var url = initialUrl
        val deadline = SystemClock.elapsedRealtime() + 8000
        repeat(5) {
            val remaining = (deadline - SystemClock.elapsedRealtime()).toInt()
            if (remaining <= 0) return null
            val connection = URI(url).toURL().openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = minOf(4000, remaining); connection.readTimeout = minOf(5000, remaining)
                connection.instanceFollowRedirects = false
                connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) Downlink/1.0")
                if (connection.responseCode in listOf(301, 302, 303, 307, 308)) {
                    url = webUrl(URI(url).resolve(connection.getHeaderField("Location") ?: return null).toString()) ?: return null
                    return@repeat
                }
                if (connection.responseCode != 200 || connection.contentLengthLong > MAX_BYTES) return null
                val bytes = connection.inputStream.use { input ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val readRemaining = (deadline - SystemClock.elapsedRealtime()).toInt()
                        if (readRemaining <= 0) return null
                        connection.readTimeout = minOf(5000, readRemaining)
                        val count = input.read(buffer)
                        if (count < 0) break
                        if (output.size() + count > MAX_BYTES) return null
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                return decode(bytes)
            } finally { connection.disconnect() }
        }
        return null
    }

    private fun decode(bytes: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 960) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    private fun frame(setSource: MediaMetadataRetriever.() -> Unit): Bitmap? {
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setSource()
            retriever.embeddedPicture?.let { decode(it)?.let { picture -> return picture } }
            val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: return null
            val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: return null
            if (width <= 0 || height <= 0) return null
            val scale = minOf(1.0, 640.0 / maxOf(width, height))
            return retriever.getScaledFrameAtTime(-1, MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
                maxOf(1, (width * scale).toInt()), maxOf(1, (height * scale).toInt()))
        } finally { retriever.release() }
    }

    fun removeJob(context: Context, id: String) {
        val cacheKey = "job:$id"
        memory.remove(cacheKey)
        file(context, cacheKey).delete()
    }

    private fun trimPreviewCache(directory: File) {
        val files = directory.listFiles()?.filter { it.extension == "jpg" }?.sortedByDescending { it.lastModified() }.orEmpty()
        var bytes = 0L
        files.forEachIndexed { index, file ->
            bytes += file.length()
            if (index >= 60 || bytes > 20 * 1024 * 1024) file.delete()
        }
    }
}
