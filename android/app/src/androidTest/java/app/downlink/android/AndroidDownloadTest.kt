package app.downlink.android

import android.Manifest
import android.content.Intent
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.SystemClock
import android.provider.MediaStore
import android.widget.EditText
import android.widget.TextView
import android.widget.ImageView
import android.view.View
import android.view.ViewGroup
import android.content.ClipData
import android.content.ClipboardManager
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

@RunWith(AndroidJUnit4::class)
class AndroidDownloadTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private lateinit var server: FixtureServer
    @Before fun setup() {
        server = FixtureServer()
        instrumentation.uiAutomation.executeShellCommand("pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}").close()
    }
    @After fun cleanup() { server.close() }

    @Test fun bundledEngineRunsAndMp4ContainsVideoAndAudio() {
        Engine.init(context)
        assertEquals(Engine.bundledVersion, YoutubeDL.execute(YoutubeDLRequest(emptyList()).addOption("--version")).out.trim())
        val info = Engine.inspect(context, server.url)
        assertEquals(1, info.size)
        assertTrue(info[0].title.isNotBlank())
        val directory = File(context.cacheDir, "test-video")
        try {
            val file = Engine.download(context, DownloadJob(options = DownloadOptions(server.url, "mp4", "best"), title = "Test video"), directory, AtomicBoolean(false)) { _, _ -> }
            assertTrue(file.length() > 100_000)
            val media = MediaMetadataRetriever()
            try {
                media.setDataSource(file.absolutePath)
                assertEquals("yes", media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO))
                assertEquals("yes", media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO))
                assertTrue(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong() in 2900..3200)
            } finally { media.release() }
        } finally { directory.deleteRecursively() }
    }

    @Test fun ffmpegProducesReal320KbpsMp3() {
        val directory = File(context.cacheDir, "test-audio")
        try {
            val file = Engine.download(context, DownloadJob(options = DownloadOptions(server.url, "mp3", "320"), title = "Test audio"), directory, AtomicBoolean(false)) { _, _ -> }
            val media = MediaExtractor()
            try {
                media.setDataSource(file.absolutePath)
                assertEquals(1, media.trackCount)
                assertEquals("audio/mpeg", media.getTrackFormat(0).getString(MediaFormat.KEY_MIME))
                assertTrue(file.length() in 110_000..140_000)
            } finally { media.release() }
        } finally { directory.deleteRecursively() }
    }

    @Test fun webmIsActuallyConvertedToPlayableMp4() {
        val directory = File(context.cacheDir, "test-recode")
        try {
            val file = Engine.download(context, DownloadJob(options = DownloadOptions(server.webmUrl, "mp4", "1080"), title = "Recode test"), directory, AtomicBoolean(false)) { _, _ -> }
            assertEquals("mp4", file.extension)
            assertTrue(String(file.readBytes().copyOfRange(4, 8)) == "ftyp")
            val media = MediaMetadataRetriever()
            try {
                media.setDataSource(file.absolutePath)
                assertEquals("yes", media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO))
                assertEquals("yes", media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO))
            } finally { media.release() }
        } finally { directory.deleteRecursively() }
    }

    @Test fun restartRecoveryMarksInterruptedWorkAndRemovesUnfinishedPublicFiles() {
        val pending = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, android.content.ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, "interrupted-downlink-test.mp4")
            put(MediaStore.Downloads.RELATIVE_PATH, "Download/Downlink")
            put(MediaStore.Downloads.IS_PENDING, 1)
        })!!
        DownloadStore.pending(pending, true)
        val job = DownloadStore.add(DownloadOptions(server.url), "Interrupted before service start")
        val temporary = File(context.cacheDir, "downloads/${job.id}/incomplete.part").apply { parentFile!!.mkdirs(); writeText("partial") }
        DownloadStore.init(context)
        assertEquals("error", DownloadStore.get(job.id)!!.state)
        assertTrue(DownloadStore.get(job.id)!!.detail.contains("interrumpida"))
        assertFalse(temporary.exists())
        context.contentResolver.query(pending, null, null, null, null)?.use { assertFalse(it.moveToFirst()) }
        DownloadStore.remove(job.id)
    }

    @Test fun shareIntentAndScreenRecreationPreserveChoices() {
        val intent = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, "Mira este vídeo ${server.url}\nCompartido desde una app").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            scenario.onActivity { activity ->
                assertEquals(server.url, activity.findViewById<EditText>(R.id.url_input).text.toString())
                activity.findViewById<android.view.View>(R.id.format_audio).performClick()
            }
            scenario.recreate()
            scenario.onActivity { activity ->
                assertEquals(server.url, activity.findViewById<EditText>(R.id.url_input).text.toString())
                assertTrue(activity.findViewById<TextView>(R.id.download_button).text.contains("MP3"))
                activity.findViewById<EditText>(R.id.url_input).setText("not a URL")
                activity.findViewById<android.view.View>(R.id.download_button).performClick()
                assertTrue(activity.findViewById<TextView>(R.id.status_text).text.contains("válido"))
            }
        }
    }

    @Test fun foregroundServiceSavesToPublicDownloadsWhileAppIsInBackground() {
        var id = ""
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                id = DownloadStore.add(DownloadOptions(server.url, "mp4", "best"), "Emulator MP4 test").id
                DownloadService.start(activity)
            }
            UiDevice.getInstance(instrumentation).pressHome()
            val job = awaitTerminal(id)
            assertEquals(job.detail, "done", job.state)
            assertTrue(job.uri.startsWith("content://media/"))
            context.contentResolver.query(Uri.parse(job.uri), arrayOf(MediaStore.Downloads.IS_PENDING, MediaStore.Downloads.RELATIVE_PATH), null, null, null)!!.use {
                assertTrue(it.moveToFirst()); assertEquals(0, it.getInt(0)); assertEquals("Download/Downlink/", it.getString(1))
            }
            val media = MediaMetadataRetriever()
            try { media.setDataSource(context, Uri.parse(job.uri)); assertEquals("yes", media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO)) }
            finally { media.release() }
        }
    }

    @Test fun cancellationCleansPartialFilesAndNextQueuedDownloadCompletes() {
        var first = ""; var second = ""
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                first = DownloadStore.add(DownloadOptions(server.slowUrl, "mp4", "best"), "Cancel this slow download").id
                second = DownloadStore.add(DownloadOptions(server.url, "mp3", "192"), "Emulator MP3 queue test").id
                DownloadService.start(activity)
            }
            assertTrue("HTTP transfer did not start", server.slowStarted.await(45, TimeUnit.SECONDS))
            scenario.onActivity { DownloadService.cancel(it, first) }
            assertEquals("cancelled", awaitTerminal(first).state)
            val next = awaitTerminal(second)
            assertEquals(next.detail, "done", next.state)
            assertEquals("", DownloadStore.get(first)!!.uri)
            assertFalse(File(context.cacheDir, "downloads/$first").exists())
            val media = MediaExtractor()
            try {
                media.setDataSource(context, Uri.parse(next.uri), null)
                assertEquals("audio/mpeg", media.getTrackFormat(0).getString(MediaFormat.KEY_MIME))
            } finally { media.release() }
        }
    }

    @Test fun instagramCookiesAreEncryptedScopedAndRemovedOnDisconnect() {
        // Synthetic credentials only; no real account or external login is used in this test.
        InstagramSession.save(context, "sessionid=synthetic-test-session; csrftoken=synthetic-token; ignored=unused")
        try {
            val encrypted = File(context.noBackupFilesDir, "instagram-session.bin").readBytes()
            assertFalse(String(encrypted).contains("synthetic-test-session"))
            assertTrue(InstagramSession.connected(context))
            assertNull(InstagramSession.cookieFile(context, "https://example.com/instagram.com"))
            assertNull(InstagramSession.cookieFile(context, "https://instagram.com.example.com/video"))
            val cookie = InstagramSession.cookieFile(context, "https://www.instagram.com/p/test/")!!
            try { assertTrue(cookie.readText().contains("\tsessionid\tsynthetic-test-session")); assertFalse(cookie.readText().contains("ignored")) }
            finally { cookie.delete() }
        } finally { InstagramSession.clear(context) }
        assertFalse(InstagramSession.connected(context))
    }

    @Test fun pastingAutomaticallyLoadsPreviewAndRecreationPreservesIt() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            // Android allows clipboard reads only once the activity has window focus.
            val focusDeadline = SystemClock.elapsedRealtime() + 10_000
            var focused = false
            while (!focused && SystemClock.elapsedRealtime() < focusDeadline) {
                scenario.onActivity { focused = it.hasWindowFocus() }
                if (!focused) SystemClock.sleep(100)
            }
            assertTrue("Activity did not receive clipboard focus", focused)
            scenario.onActivity { activity ->
                activity.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Video", server.previewUrl))
                descendants(activity.window.decorView).filterIsInstance<TextView>().first { it.text.toString() == "Pegar" }.performClick()
                assertEquals(server.previewUrl, activity.findViewById<EditText>(R.id.url_input).text.toString())
            }
            awaitPreview(scenario) { it.findViewById(R.id.link_thumbnail) }
            scenario.recreate()
            awaitPreview(scenario) { it.findViewById(R.id.link_thumbnail) }
            scenario.onActivity { activity ->
                assertTrue(descendants(activity.window.decorView).filterIsInstance<TextView>().any { it.text.contains("Preview fixture") })
                activity.findViewById<EditText>(R.id.url_input).setText("not a URL")
                assertNull("Old thumbnail must disappear when the link changes", activity.findViewById<View>(R.id.link_thumbnail))
            }
        }
    }

    @Test fun audioDownloadWithoutAnalysisPersistsThumbnailAndHistoryWorksOffline() {
        val info = Engine.inspect(context, server.previewUrl).single()
        assertEquals(server.posterUrl, info.thumbnailUrl)
        var id = ""
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                // No title or image passed in: the download itself must capture its metadata.
                id = DownloadStore.add(DownloadOptions(server.previewUrl, "mp3", "192"), "Pending metadata").id
                DownloadService.start(activity)
            }
            val job = awaitTerminal(id)
            try {
                assertEquals(job.detail, "done", job.state)
                assertEquals(server.posterUrl, job.thumbnailUrl)
                assertTrue(job.title.contains("Preview fixture"))
                val restored = DownloadJob.fromJson(JSONObject(job.json().toString()))
                assertEquals(job.thumbnailUrl, restored.thumbnailUrl)
                server.close()
                Thumbnails.trimMemory()
                scenario.onActivity { it.findViewById<View>(R.id.library_tab).performClick() }
                awaitPreview(scenario) { it.window.decorView.findViewWithTag("history-thumbnail:$id") }
                // Clearing memory and recreating forces another read of the persistent JPEG.
                Thumbnails.trimMemory()
                scenario.recreate()
                awaitPreview(scenario) { it.window.decorView.findViewWithTag("history-thumbnail:$id") }
            } finally {
                if (job.uri.isNotBlank()) context.contentResolver.delete(Uri.parse(job.uri), null, null)
                DownloadStore.remove(id)
            }
        }
    }

    @Test fun oldHistoryWithoutImageUsesSavedVideoFrameAndMissingRemoteImageFallsBack() {
        val original = DownloadStore.add(DownloadOptions(server.url), "Old video entry")
        val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, android.content.ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, "thumbnail-legacy-test.mp4")
            put(MediaStore.Downloads.RELATIVE_PATH, "Download/Downlink")
            put(MediaStore.Downloads.IS_PENDING, 1)
        })!!
        try {
            context.contentResolver.openOutputStream(uri)!!.use { output ->
                instrumentation.context.assets.open("sample.mp4").use { it.copyTo(output) }
            }
            context.contentResolver.update(uri, android.content.ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            val oldJson = original.copy(state = "done", uri = uri.toString()).json().apply { remove("thumbnailUrl") }
            val legacy = DownloadJob.fromJson(oldJson)
            assertEquals("", legacy.thumbnailUrl)
            DownloadStore.update(original.id) { legacy }
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { it.findViewById<View>(R.id.library_tab).performClick() }
                awaitPreview(scenario) { it.window.decorView.findViewWithTag("history-thumbnail:${legacy.id}") }
                Thumbnails.removeJob(context, legacy.id)
                DownloadStore.update(legacy.id) { it.copy(thumbnailUrl = server.missingPosterUrl) }
                awaitPreview(scenario) { it.window.decorView.findViewWithTag("history-thumbnail:${legacy.id}") }
            }
        } finally {
            context.contentResolver.delete(uri, null, null)
            DownloadStore.update(original.id) { it.copy(state = "done") }
            DownloadStore.remove(original.id)
        }
    }

    private fun descendants(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup) for (i in 0 until view.childCount) yieldAll(descendants(view.getChildAt(i)))
    }

    private fun awaitPreview(scenario: ActivityScenario<MainActivity>, root: (MainActivity) -> View?) {
        val deadline = SystemClock.elapsedRealtime() + 60_000
        while (SystemClock.elapsedRealtime() < deadline) {
            var loaded = false
            scenario.onActivity { activity ->
                loaded = root(activity)?.let { view -> descendants(view).filterIsInstance<ImageView>().any { it.drawable != null && it.visibility == View.VISIBLE } } == true
            }
            if (loaded) return
            SystemClock.sleep(150)
        }
        throw AssertionError("Thumbnail did not appear")
    }

    private fun awaitTerminal(id: String): DownloadJob {
        val deadline = SystemClock.elapsedRealtime() + 90_000
        while (SystemClock.elapsedRealtime() < deadline) {
            DownloadStore.get(id)?.let { if (it.terminal) return it }
            SystemClock.sleep(200)
        }
        throw AssertionError("Download timed out: ${DownloadStore.get(id)}")
    }
}
