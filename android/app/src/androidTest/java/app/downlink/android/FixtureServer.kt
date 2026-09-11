package app.downlink.android

import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.Bitmap
import android.graphics.Color
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors

/** A real HTTP origin inside the emulator; production extraction/conversion is never mocked. */
class FixtureServer : Closeable {
    private val bytes = InstrumentationRegistry.getInstrumentation().context.assets.open("sample.mp4").use { it.readBytes() }
    private val webm = InstrumentationRegistry.getInstrumentation().context.assets.open("sample.webm").use { it.readBytes() }
    private val socket = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    private val pool = Executors.newCachedThreadPool { r -> Thread(r).apply { isDaemon = true } }
    val slowStarted = CountDownLatch(1)
    val url = "http://127.0.0.1:${socket.localPort}/sample.mp4"
    val slowUrl = "http://127.0.0.1:${socket.localPort}/slow.mp4"
    val webmUrl = "http://127.0.0.1:${socket.localPort}/sample.webm"
    val previewUrl = "http://127.0.0.1:${socket.localPort}/preview.html"
    val posterUrl = "http://127.0.0.1:${socket.localPort}/poster.jpg"
    val missingPosterUrl = "http://127.0.0.1:${socket.localPort}/missing.jpg"
    private val poster = ByteArrayOutputStream().use { output ->
        Bitmap.createBitmap(320, 180, Bitmap.Config.ARGB_8888).also {
            it.eraseColor(Color.rgb(198, 241, 120))
            it.compress(Bitmap.CompressFormat.JPEG, 90, output)
            it.recycle()
        }
        output.toByteArray()
    }
    private val page = """<!doctype html><html><head><title>Preview fixture</title>
        <meta property="og:title" content="Preview fixture">
        <meta property="og:image" content="$posterUrl"></head>
        <body><video controls poster="$posterUrl"><source src="$url" type="video/mp4"></video></body></html>""".toByteArray()
    init {
        pool.execute {
            while (!socket.isClosed) {
                val client = try { socket.accept() } catch (_: Exception) { break }
                pool.execute {
                    runCatching {
                        client.use {
                            val input = client.getInputStream().bufferedReader()
                            val request = input.readLine().orEmpty()
                            var line = input.readLine()
                            var range = 0
                            while (!line.isNullOrEmpty()) {
                                if (line.startsWith("Range:", true)) range = line.substringAfter("bytes=").substringBefore('-').toIntOrNull() ?: 0
                                line = input.readLine()
                            }
                            val slow = request.contains("/slow.mp4")
                            val missing = request.contains("/missing.jpg")
                            val payload = when {
                                request.contains("/poster.jpg") -> poster
                                request.contains("/preview.html") -> page
                                request.contains("/sample.webm") -> webm
                                missing -> byteArrayOf()
                                else -> bytes
                            }
                            val mime = when (payload) { poster -> "image/jpeg"; page -> "text/html"; webm -> "video/webm"; else -> "video/mp4" }
                            val length = payload.size * if (slow) 80 else 1
                            val output = client.getOutputStream()
                            val headers = buildString {
                                append(if (missing) "HTTP/1.1 404 Not Found\r\n" else if (range > 0) "HTTP/1.1 206 Partial Content\r\n" else "HTTP/1.1 200 OK\r\n")
                                append("Content-Type: $mime\r\nContent-Length: ${length - range}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n")
                                if (range > 0) append("Content-Range: bytes $range-${length - 1}/$length\r\n")
                                append("\r\n")
                            }
                            output.write(headers.toByteArray()); output.flush()
                            if (!request.startsWith("HEAD")) {
                                if (slow) slowStarted.countDown()
                                var offset = range
                                while (offset < length) {
                                    val start = offset % payload.size
                                    val count = minOf(8192, payload.size - start, length - offset)
                                    output.write(payload, start, count); output.flush(); offset += count
                                    if (slow) Thread.sleep(30)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    override fun close() { socket.close(); pool.shutdownNow() }
}
