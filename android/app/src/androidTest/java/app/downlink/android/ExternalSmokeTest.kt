package app.downlink.android

import android.media.MediaMetadataRetriever
import android.os.Bundle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/** Opt-in: -e liveUrl https://... ; external availability is not a deterministic test. */
@RunWith(AndroidJUnit4::class)
class ExternalSmokeTest {
    @Test fun downloadPublicVideoFromRealPlatform() {
        val args = InstrumentationRegistry.getArguments()
        val url = args.getString("liveUrl")
        assumeTrue("Pass liveUrl to run the external network smoke test", url != null)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val media = Engine.inspect(context, url!!).first()
        val format = args.getString("liveFormat") ?: "mp4"
        val directory = File(context.getExternalFilesDir(null), "live-smoke")
        directory.deleteRecursively()
        val file = Engine.download(context, DownloadJob(options = DownloadOptions(url, format, if (format == "mp3") "192" else (args.getString("liveQuality") ?: "best")), title = media.title), directory, AtomicBoolean(false)) { _, _ -> }
        assertTrue(file.length() > 1000)
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(file.absolutePath)
            assertTrue(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong() > 0)
            if (format == "mp4") assertEquals("yes", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO))
            if (format == "mp3" || media.hasAudio) assertEquals("yes", retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO))
        } finally { retriever.release() }
        InstrumentationRegistry.getInstrumentation().sendStatus(0, Bundle().apply {
            putString("stream", "\nLIVE DOWNLOAD OK: ${media.title}; ${file.length()} bytes; ${file.absolutePath}\n")
        })
    }
}
