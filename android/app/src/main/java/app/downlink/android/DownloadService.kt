package app.downlink.android

import android.app.*
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.*
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class DownloadService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var running = false
    @Volatile private var active: DownloadJob? = null
    private val cancelled = AtomicBoolean(false)
    private var wakeLock: PowerManager.WakeLock? = null
    private var lastProgress = 0L
    @Volatile private var timedOut = false

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Descargas", NotificationManager.IMPORTANCE_LOW))
    }
    override fun onBind(intent: Intent?) = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == CANCEL) {
            val id = intent.getStringExtra("id") ?: return START_NOT_STICKY
            if (active?.id == id) {
                cancelled.set(true)
                killCancelled(id)
            } else DownloadStore.update(id) { if (it.state == "queued") it.copy(state = "cancelled", detail = "Cancelado") else it }
        }
        if (!running) {
            startForeground(NOTIFICATION, notification("Preparando descargas…", 0, null), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            running = true
            executor.execute { drain() }
        }
        return START_NOT_STICKY
    }
    private fun killCancelled(id: String) {
        if (active?.id != id || !cancelled.get()) return
        Engine.cancel(this, id)
        main.postDelayed({ killCancelled(id) }, 300)
    }
    private fun drain() {
        while (!timedOut) {
            val job = DownloadStore.claimNext() ?: break
            cancelled.set(false)
            active = job
            val directory = File(cacheDir, "downloads/${job.id}")
            try {
                if (DownloadStore.get(job.id)?.state == "cancelling") cancelled.set(true)
                check(!cancelled.get()) { "Cancelado" }
                wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
                    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Downlink:download").apply { acquire(6 * 60 * 60 * 1000L) }
                notifyProgress(job, 0, "Preparando descarga…")
                val file = Engine.download(this, job, directory, cancelled) { progress, detail ->
                    if (SystemClock.elapsedRealtime() - lastProgress > 500) {
                        lastProgress = SystemClock.elapsedRealtime()
                        DownloadStore.update(job.id) { it.copy(progress = progress, detail = detail) }
                        notifyProgress(job, progress, detail)
                    }
                }
                check(!cancelled.get()) { "Cancelado" }
                // Thumbnail failures must never turn a successful media download into an error.
                runCatching { Thumbnails.prepareJob(this, DownloadStore.get(job.id) ?: job, file) }
                check(!cancelled.get()) { "Cancelado" }
                DownloadStore.update(job.id) { it.copy(detail = "Guardando en Descargas…", progress = 99) }
                publish(job, file)
                completedNotification(job)
            } catch (error: Exception) {
                val stopped = cancelled.get()
                DownloadStore.update(job.id) { it.copy(state = if (stopped) "cancelled" else "error",
                    detail = if (stopped) "Cancelado" else Engine.friendlyError(error)) }
                if (!stopped) notifyResult(job.id, job.title, "La descarga falló. Toca para ver el motivo.")
            } finally {
                wakeLock?.let { if (it.isHeld) it.release() }
                wakeLock = null
                directory.deleteRecursively()
                active = null
            }
        }
        main.post {
            running = false
            if (!timedOut && DownloadStore.next() != null) {
                running = true
                executor.execute { drain() }
            } else {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }
    private fun publish(job: DownloadJob, file: File) {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, file.name)
            put(MediaStore.Downloads.MIME_TYPE, if (job.options.format == "mp3") "audio/mpeg" else "video/mp4")
            put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Downlink")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: error("No se pudo crear el archivo en Descargas.")
        DownloadStore.pending(uri, true)
        try {
            contentResolver.openOutputStream(uri, "w")!!.use { output ->
                file.inputStream().use { input ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        check(!cancelled.get()) { "Cancelado" }
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                    }
                }
            }
            check(!cancelled.get()) { "Cancelado" }
            contentResolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            val name = contentResolver.query(uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) it.getString(0) else file.name
            } ?: file.name
            DownloadStore.complete(job.id, uri, name, file.length())
        } catch (e: Exception) {
            contentResolver.delete(uri, null, null)
            DownloadStore.pending(uri, false)
            throw e
        }
    }
    private fun notification(detail: String, progress: Int, job: DownloadJob?): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_download)
            .setContentTitle(job?.title ?: "Downlink").setContentText(detail).setContentIntent(open)
            .setOnlyAlertOnce(true).setOngoing(true).setProgress(100, progress, progress == 0)
            .apply {
                if (job != null) addAction(0, "Cancelar", PendingIntent.getService(this@DownloadService, job.id.hashCode(),
                    Intent(this@DownloadService, DownloadService::class.java).setAction(CANCEL).putExtra("id", job.id), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            }.build()
    }
    private fun notifyProgress(job: DownloadJob, progress: Int, detail: String) {
        runCatching { getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification(detail, progress, job)) }
    }
    private fun completedNotification(job: DownloadJob) = notifyResult(job.id, DownloadStore.get(job.id)?.title ?: job.title, "Guardado · ${job.options.format.uppercase()} · Download/Downlink")
    private fun notifyResult(id: String, title: String, detail: String) {
        val open = PendingIntent.getActivity(this, id.hashCode(), Intent(this, MainActivity::class.java).putExtra("tab", "downloads"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        runCatching {
            getSystemService(NotificationManager::class.java).notify(id.hashCode(), NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_download).setContentTitle(title).setContentText(detail)
                .setContentIntent(open).setAutoCancel(true).build())
        }
    }
    override fun onTimeout(startId: Int, fgsType: Int) {
        timedOut = true
        cancelled.set(true)
        active?.let { Engine.cancel(this, it.id) }
        DownloadStore.all().filter { !it.terminal }.forEach { job ->
            DownloadStore.update(job.id) { it.copy(state = "error", detail = "Android ha alcanzado el límite de trabajo en segundo plano. Reintenta desde la app.") }
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }
    override fun onDestroy() {
        timedOut = true
        cancelled.set(true)
        active?.let { Engine.cancel(this, it.id) }
        main.removeCallbacksAndMessages(null)
        executor.shutdown()
        wakeLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }
    companion object {
        private const val CHANNEL = "downloads"
        private const val NOTIFICATION = 100
        private const val CANCEL = "app.downlink.android.CANCEL"
        fun start(context: Context) = context.startForegroundService(Intent(context, DownloadService::class.java))
        fun cancel(context: Context, id: String) {
            val job = DownloadStore.get(id) ?: return
            if (!job.terminal) {
                DownloadStore.update(id) {
                    if (it.state == "queued") it.copy(state = "cancelled", detail = "Cancelado")
                    else if (!it.terminal) it.copy(state = "cancelling", detail = "Cancelando…") else it
                }
                if (DownloadStore.get(id)?.state == "cancelling") context.startService(Intent(context, DownloadService::class.java).setAction(CANCEL).putExtra("id", id))
            }
        }
    }
}
