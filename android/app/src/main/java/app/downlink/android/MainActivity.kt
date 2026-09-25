package app.downlink.android

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.*
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.*
import android.provider.Settings
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.*
import android.view.inputmethod.InputMethodManager
import android.widget.*
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import kotlin.math.roundToInt

class MainActivity : Activity() {
    private val canvasColor = Color.rgb(16, 20, 16)
    private val surface = Color.rgb(27, 33, 27)
    private val border = Color.rgb(52, 61, 49)
    private val green = Color.rgb(197, 242, 119)
    private val muted = Color.rgb(163, 177, 157)
    private val white = Color.rgb(242, 246, 238)
    private lateinit var content: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var tabs: LinearLayout
    private var urlInput: EditText? = null
    private var activePanel: LinearLayout? = null
    private var statusText: TextView? = null
    private var preview: LinearLayout? = null
    private var qualitySpinner: Spinner? = null
    private var tab = "home"
    private var rawUrl = ""
    private var format = "mp4"
    private var quality = "1080"
    private var info = emptyList<MediaInfo>()
    private var selected = 0
    private var inspecting = false
    private var engineUpdating = false
    private var status = ""
    private var started = false
    private var lastAnalysisUrl = ""
    private var inputGeneration = 0
    private val previewHandler = Handler(Looper.getMainLooper())
    private val autoPreview = Runnable { if (started && tab == "home") analyze(automatic = true) }
    private val executor = Executors.newSingleThreadExecutor()
    private val observer: () -> Unit = {
        if (tab == "downloads") renderLibrary() else renderActive()
        schedulePreview()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getPreferences(MODE_PRIVATE)
        format = savedInstanceState?.getString("format") ?: prefs.getString("format", "mp4")!!
        quality = savedInstanceState?.getString("quality") ?: prefs.getString("quality", "1080")!!
        if (quality !in qualities()) quality = qualities().first()
        rawUrl = savedInstanceState?.getString("url").orEmpty()
        tab = savedInstanceState?.getString("tab") ?: "home"
        selected = savedInstanceState?.getInt("selected") ?: 0
        savedInstanceState?.getString("info")?.let { text ->
            runCatching {
                val array = JSONArray(text)
                info = (0 until array.length()).map { index ->
                    val j = array.getJSONObject(index)
                    MediaInfo(j.getString("title"), j.getString("uploader"), j.getLong("duration"), j.getInt("item"), j.getBoolean("live"), j.optString("id").takeIf { it.isNotBlank() }, j.optBoolean("hasAudio", true), j.optString("thumbnailUrl"))
                }
            }
        }
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(canvasColor) }
        val header = horizontal().apply { setPadding(dp(24), dp(12), dp(24), dp(10)); gravity = Gravity.CENTER_VERTICAL }
        header.addView(label("↓  downlink", 24, white, true), LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(label("ANDROID", 10, green, true).apply { letterSpacing = .18f; setPadding(dp(12), dp(8), dp(12), dp(8)); background = rounded(surface, 20) })
        root.addView(header)
        scroll = ScrollView(this).apply { isFillViewport = true; clipToPadding = false }
        content = vertical().apply { setPadding(dp(24), dp(10), dp(24), dp(24)) }
        scroll.addView(content)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        tabs = horizontal().apply { setPadding(dp(12), dp(6), dp(12), dp(6)); background = rounded(surface, 0) }
        root.addView(tabs)
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom); insets
        }
        if (savedInstanceState == null) receiveIntent(intent)
        showTab(tab)
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent); receiveIntent(intent); showTab(tab)
    }
    private fun receiveIntent(intent: Intent) {
        if (intent.action == Intent.ACTION_SEND) {
            val shared = intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
            rawUrl = DownloadOptions.extractUrl(shared) ?: shared
            inputGeneration++; lastAnalysisUrl = ""
            info = emptyList(); selected = 0; status = "Enlace recibido. Elige el formato y descarga."; tab = "home"
        }
        if (intent.getStringExtra("tab") == "downloads") tab = "downloads"
    }
    override fun onStart() { super.onStart(); started = true; DownloadStore.observe(observer) }
    override fun onResume() { super.onResume(); if (tab == "settings") renderSettings() }
    override fun onStop() { started = false; previewHandler.removeCallbacks(autoPreview); DownloadStore.unobserve(observer); super.onStop() }
    override fun onDestroy() { previewHandler.removeCallbacksAndMessages(null); executor.shutdown(); super.onDestroy() }
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("url", rawUrl); outState.putString("format", format); outState.putString("quality", quality)
        outState.putString("tab", tab); outState.putInt("selected", selected)
        outState.putString("info", JSONArray().apply { info.forEach {
            put(JSONObject().put("title", it.title).put("uploader", it.uploader).put("duration", it.duration).put("item", it.item).put("live", it.isLive).put("id", it.id).put("hasAudio", it.hasAudio).put("thumbnailUrl", it.thumbnailUrl))
        } }.toString())
        super.onSaveInstanceState(outState)
    }
    private fun showTab(value: String) {
        tab = value
        urlInput = null; activePanel = null; statusText = null; preview = null; qualitySpinner = null
        tabs.removeAllViews()
        listOf(Triple("home", "↓ Descargar", R.id.home_tab), Triple("downloads", "▤ Biblioteca", R.id.library_tab), Triple("settings", "⚙ Ajustes", R.id.settings_tab)).forEach { (key, title, viewId) ->
            tabs.addView(button(title, tab == key).apply { id = viewId; textSize = 12f; setOnClickListener { hideKeyboard(); showTab(key) } }, LinearLayout.LayoutParams(0, dp(48), 1f))
        }
        when (tab) { "downloads" -> renderLibrary(); "settings" -> renderSettings(); else -> renderHome() }
        scroll.scrollTo(0, 0)
        schedulePreview()
    }
    private fun renderHome() {
        content.removeAllViews()
        content.addView(label("TUS VÍDEOS, CONTIGO", 11, green, true).apply { letterSpacing = .16f }, spaced(14))
        content.addView(label("Un enlace.\nTodo a mano.", 38, white, true).apply { setLineSpacing(0f, .98f) }, spaced(10))
        content.addView(label("Guarda vídeo o audio directamente en tu móvil.", 15, muted), spaced(22))
        content.addView(label("YouTube  ·  Instagram  ·  TikTok\nX  ·  Reddit  ·  Twitch  ·  y más", 12, muted), spaced(20))

        val card = card()
        card.addView(label("ENLACE DEL VÍDEO", 10, muted, true).apply { letterSpacing = .12f }, spaced(12))
        val input = EditText(this).apply {
            id = R.id.url_input; hint = "Pega un enlace o @usuario"; contentDescription = "Enlace del vídeo"
            setTextColor(white); setHintTextColor(muted); textSize = 15f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true); setPadding(dp(14), dp(10), dp(14), dp(10)); background = rounded(canvasColor, 14, border)
            setText(rawUrl); imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_GO
            setOnEditorActionListener { _, _, _ -> analyze(); true }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    rawUrl = s.toString(); inputGeneration++; lastAnalysisUrl = ""; info = emptyList(); selected = 0; renderPreview(); schedulePreview()
                }
                override fun afterTextChanged(s: Editable?) {}
            })
        }
        urlInput = input
        card.addView(input, LinearLayout.LayoutParams(-1, dp(56)))
        val actions = horizontal()
        actions.addView(button("Pegar").apply { setOnClickListener { paste() } }, weighted())
        actions.addView(button(if (inspecting) "Analizando…" else "Analizar").apply {
            id = R.id.analyze_button; isEnabled = !inspecting; setOnClickListener { analyze() }
        }, weighted())
        card.addView(actions, spaced(8))
        preview = vertical().also { card.addView(it) }
        renderPreview()
        statusText = label(status, 12, muted).apply { id = R.id.status_text; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        card.addView(statusText, spaced(14))
        card.addView(label("ELIGE QUÉ GUARDAR", 10, muted, true).apply { letterSpacing = .12f }, spaced(10))
        val formats = horizontal()
        formats.addView(button("▷  Vídeo · MP4", format == "mp4").apply { id = R.id.format_video; setOnClickListener { changeFormat("mp4") } }, weighted())
        formats.addView(button("♫  Audio · MP3", format == "mp3").apply { id = R.id.format_audio; setOnClickListener { changeFormat("mp3") } }, weighted())
        card.addView(formats, spaced(16))
        card.addView(label(if (format == "mp3") "Calidad de audio" else "Resolución máxima", 12, muted), spaced(4))
        qualitySpinner = Spinner(this).apply {
            id = R.id.quality_spinner; contentDescription = "Calidad"
            background = rounded(canvasColor, 12, border)
            adapter = object : ArrayAdapter<String>(this@MainActivity, android.R.layout.simple_spinner_item, qualityLabels()) {
                override fun getView(position: Int, convertView: View?, parent: ViewGroup): View =
                    (super.getView(position, convertView, parent) as TextView).apply { setTextColor(white); textSize = 15f; setPadding(dp(14), dp(12), dp(8), dp(12)) }
            }.apply { setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
            setSelection(qualities().indexOf(quality).coerceAtLeast(0))
            onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                    quality = qualities()[position]; saveChoices()
                }
                override fun onNothingSelected(parent: AdapterView<*>?) {}
            }
        }
        card.addView(qualitySpinner, LinearLayout.LayoutParams(-1, dp(52)))
        card.addView(button("↓  Descargar ${format.uppercase()}", true).apply {
            id = R.id.download_button; textSize = 16f; setOnClickListener { download() }
        }, spaced(4, 58).apply { topMargin = dp(18) })
        card.addView(label("Se guarda en Download / Downlink", 11, muted).apply { gravity = Gravity.CENTER }, spaced(0))
        content.addView(card, spaced(20))
        activePanel = vertical().also { content.addView(it) }
        renderActive()
        content.addView(label("También puedes usar Compartir → Downlink\ndesde tus aplicaciones favoritas.", 12, muted).apply { gravity = Gravity.CENTER }, spaced(0))
    }
    private fun renderPreview() {
        val panel = preview ?: return
        panel.removeAllViews()
        info.getOrNull(selected)?.let { media ->
            panel.addView(thumbnail(media.thumbnailUrl, title = media.title, compact = false).apply { id = R.id.link_thumbnail }, spaced(14))
            panel.addView(label(media.title, 17, white, true), spaced(6))
            if (!media.hasAudio) panel.addView(label("Vídeo sin pista de audio · Solo MP4", 12, muted), spaced(6))
            panel.addView(label(listOf(media.uploader, if (media.duration > 0) "${media.duration / 60}:${(media.duration % 60).toString().padStart(2, '0')}" else "").filter { it.isNotBlank() }.joinToString(" · "), 12, muted), spaced(10))
            if (info.size > 1) panel.addView(button("Elemento ${selected + 1} de ${info.size} · Elegir").apply {
                setOnClickListener { AlertDialog.Builder(this@MainActivity).setTitle("Elige el vídeo")
                    .setSingleChoiceItems(info.mapIndexed { i, m -> "${i + 1}. ${m.title}" }.toTypedArray(), selected) { dialog, which -> selected = which; renderPreview(); dialog.dismiss() }.show() }
            })
        }
    }
    private fun schedulePreview() {
        previewHandler.removeCallbacks(autoPreview)
        val url = DownloadOptions.extractUrl(rawUrl) ?: return
        if (started && tab == "home" && !inspecting && !engineUpdating && info.isEmpty() && lastAnalysisUrl != url && DownloadStore.all().none { !it.terminal }) {
            previewHandler.postDelayed(autoPreview, 750)
        }
    }
    private fun analyze(automatic: Boolean = false) {
        val url = DownloadOptions.extractUrl(rawUrl) ?: return setStatus("Pega un enlace HTTP o HTTPS válido.")
        previewHandler.removeCallbacks(autoPreview)
        if (inspecting) return
        if (DownloadStore.all().any { !it.terminal }) return setStatus("Espera a que termine la descarga para analizar otro enlace. Puedes añadir enlaces a la cola directamente.")
        if (!automatic) hideKeyboard()
        inspecting = true; lastAnalysisUrl = url
        setStatus("Buscando vista previa, título y formatos…")
        findViewById<Button>(R.id.analyze_button)?.apply { text = "Analizando…"; isEnabled = false }
        val generation = inputGeneration
        executor.execute {
            val result = runCatching { Engine.inspect(this, url) }
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                inspecting = false
                if (generation != inputGeneration) { status = "Preparando el nuevo enlace…" }
                else result.onSuccess { info = it; selected = 0; status = if (it[0].isLive) "Las emisiones en directo no se descargan. Prueba cuando haya terminado." else "${it.size} vídeo${if (it.size == 1) "" else "s"} disponible${if (it.size == 1) "" else "s"}." }
                    .onFailure { status = Engine.friendlyError(it) }
                if (tab == "home") {
                    setStatus(status); renderPreview()
                    findViewById<Button>(R.id.analyze_button)?.apply { text = "Analizar"; isEnabled = true }
                }
                schedulePreview()
            }
        }
    }
    private fun paste() {
        val clipboard = getSystemService(ClipboardManager::class.java)
        val text = clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()
        if (text.isNullOrBlank()) return setStatus("El portapapeles está vacío.")
        urlInput?.setText(DownloadOptions.extractUrl(text) ?: text)
    }
    private fun download() {
        val url = DownloadOptions.extractUrl(rawUrl) ?: return setStatus("Pega un enlace HTTP o HTTPS válido.")
        if (info.getOrNull(selected)?.isLive == true) return setStatus("Espera a que termine la emisión en directo.")
        if (format == "mp3" && info.getOrNull(selected)?.hasAudio == false) return setStatus("Este vídeo no tiene pista de audio. Elige MP4.")
        val options = runCatching { DownloadOptions(url, format, quality, info.getOrNull(selected)?.item ?: 1, info.getOrNull(selected)?.id) }
            .getOrElse { return setStatus(it.message.orEmpty()) }
        hideKeyboard()
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            && !getPreferences(MODE_PRIVATE).getBoolean("notificationAsked", false)) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("notificationAsked", true).apply()
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        enqueue(options, info.getOrNull(selected)?.title ?: DownloadOptions.platform(url), info.getOrNull(selected)?.thumbnailUrl.orEmpty())
    }
    private fun enqueue(options: DownloadOptions, title: String, thumbnailUrl: String = "") {
        previewHandler.removeCallbacks(autoPreview)
        lastAnalysisUrl = options.url
        val job = DownloadStore.add(options, title, thumbnailUrl)
        runCatching { DownloadService.start(this) }.onSuccess { setStatus("Añadido a descargas. Puedes seguir usando el móvil.") }
            .onFailure { error -> DownloadStore.update(job.id) { it.copy(state = "error", detail = Engine.friendlyError(error)) } }
    }
    private fun changeFormat(value: String) {
        if (format == value) return
        format = value; quality = if (value == "mp3") "320" else "1080"; saveChoices(); renderHome()
    }
    private fun saveChoices() { getPreferences(MODE_PRIVATE).edit().putString("format", format).putString("quality", quality).apply() }
    private fun qualities() = if (format == "mp3") DownloadOptions.audioQualities else DownloadOptions.videoQualities
    private fun qualityLabels() = qualities().map { if (format == "mp3") "$it kbps" else when (it) { "best" -> "Mejor disponible"; "4320" -> "4320p · 8K"; "2160" -> "2160p · 4K"; "1080" -> "1080p · Full HD"; "720" -> "720p · HD"; else -> "${it}p" } }
    private fun setStatus(message: String) { status = message; statusText?.text = message }
    private fun renderActive() {
        val panel = activePanel ?: return
        panel.removeAllViews()
        DownloadStore.all().filter { !it.terminal }.take(3).forEach { panel.addView(jobCard(it), spaced(12)) }
        if (panel.childCount == 0) DownloadStore.all().firstOrNull()?.let { job ->
            panel.addView(button(if (job.state == "done") "✓ Última descarga guardada · Ver biblioteca" else "Ver última descarga en Biblioteca").apply { setOnClickListener { showTab("downloads") } }, spaced(16))
        }
    }
    private fun renderLibrary() {
        val position = scroll.scrollY
        content.removeAllViews()
        content.addView(label("Tu biblioteca", 30, white, true), spaced(8))
        content.addView(label("Tus descargas, listas para llevar.", 14, muted), spaced(20))
        content.addView(button("Abrir carpeta de Descargas").apply { setOnClickListener {
            runCatching { startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS)) }.onFailure { toast("Abre la app Archivos → Descargas → Downlink.") }
        } }, spaced(18))
        val jobs = DownloadStore.all()
        if (jobs.isEmpty()) content.addView(card().apply {
            addView(label("↓", 48, green)); addView(label("Aquí empieza tu colección", 20, white, true), spaced(12))
            addView(label("Pega o comparte un enlace para guardar tu primer vídeo o audio.", 14, muted))
        }) else jobs.forEach { content.addView(jobCard(it), spaced(14)) }
        scroll.post { scroll.scrollTo(0, position) }
    }
    private fun jobCard(job: DownloadJob): LinearLayout = card().apply {
        addView(label("${job.options.format.uppercase()}  ·  ${if (job.options.format == "mp3") "${job.options.quality} kbps" else if (job.options.quality == "best") "Original" else "${job.options.quality}p"}  ·  ${DownloadOptions.platform(job.options.url)}", 10, green, true), spaced(8))
        val summary = horizontal().apply { gravity = Gravity.CENTER_VERTICAL }
        summary.addView(thumbnail(job.thumbnailUrl, job, job.title, compact = true).apply { tag = "history-thumbnail:${job.id}" }, LinearLayout.LayoutParams(dp(96), dp(80)).apply { marginEnd = dp(14) })
        summary.addView(vertical().apply {
            addView(label(job.title, 16, white, true).apply { maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END }, spaced(8))
            addView(label(when (job.state) { "done" -> "✓ Guardado · ${android.text.format.Formatter.formatShortFileSize(this@MainActivity, job.size)}"; "error" -> "No se pudo descargar"; else -> job.detail }, 12, if (job.state == "error") Color.rgb(255, 177, 167) else muted))
        }, LinearLayout.LayoutParams(0, -2, 1f))
        addView(summary, spaced(14))
        if (!job.terminal) addView(ProgressBar(this@MainActivity, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100; progress = job.progress; isIndeterminate = job.progress == 0
            progressTintList = ColorStateList.valueOf(green); indeterminateTintList = ColorStateList.valueOf(green)
        }, spaced(8, 6))
        val row = horizontal()
        if (job.state == "done") {
            row.addView(button("Abrir").apply { setOnClickListener { openFile(job, false) } }, weighted())
            row.addView(button("Compartir").apply { setOnClickListener { openFile(job, true) } }, weighted())
        } else if (job.terminal) {
            row.addView(button("Reintentar").apply { setOnClickListener { enqueue(job.options, job.title, job.thumbnailUrl) } }, weighted())
            if (job.state == "error") row.addView(button("Ver motivo").apply { setOnClickListener {
                AlertDialog.Builder(this@MainActivity).setTitle("Detalle de la descarga").setMessage(job.detail).setPositiveButton("Aceptar", null).show()
            } }, weighted())
        } else row.addView(button("Cancelar").apply { setOnClickListener { DownloadService.cancel(this@MainActivity, job.id) } }, weighted())
        addView(row)
        if (tab == "downloads" && job.terminal) addView(button("Quitar del historial").apply {
            textSize = 11f; setTextColor(muted); setOnClickListener { DownloadStore.remove(job.id) }
        }, LinearLayout.LayoutParams(-1, dp(48)))
    }
    private fun openFile(job: DownloadJob, share: Boolean) {
        val uri = Uri.parse(job.uri)
        runCatching { contentResolver.openFileDescriptor(uri, "r")?.close() ?: error("missing") }.onFailure {
            toast("El archivo se ha movido o eliminado. Puedes volver a descargarlo."); return
        }
        val type = if (job.options.format == "mp3") "audio/mpeg" else "video/mp4"
        val action = if (share) Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri)
            .apply { clipData = ClipData.newRawUri(job.filename, uri) }
        else Intent(Intent.ACTION_VIEW).setDataAndType(uri, type)
        action.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        runCatching { startActivity(Intent.createChooser(action, if (share) "Compartir archivo" else "Abrir archivo")) }
            .onFailure { toast("Instala un reproductor compatible para abrir este archivo.") }
    }
    private fun renderSettings() {
        content.removeAllViews()
        content.addView(label("A tu manera", 30, white, true), spaced(8))
        content.addView(label("Todo se procesa en tu dispositivo.", 14, muted), spaced(24))
        val account = card()
        val connected = InstagramSession.connected(this)
        account.addView(label("Instagram", 20, white, true), spaced(8))
        account.addView(label(if (connected) "Cuenta conectada · hasta 8 horas" else "Conecta tu cuenta para intentar descargar stories y vídeos que puedes ver.", 14, muted), spaced(12))
        account.addView(button(if (connected) "Desconectar cuenta" else "Conectar Instagram", !connected).apply {
            setOnClickListener {
                if (connected) {
                    DownloadStore.all().filter { it.authenticated && !it.terminal }.forEach { DownloadService.cancel(this@MainActivity, it.id) }
                    InstagramSession.clear(this@MainActivity); renderSettings()
                } else startActivity(Intent(this@MainActivity, InstagramActivity::class.java))
            }
        })
        account.addView(label("La sesión se cifra en el móvil. El soporte de stories depende de Instagram; no recupera contenido caducado.", 11, muted))
        content.addView(account, spaced(16))
        content.addView(card().apply {
            addView(label("Motor de descarga", 20, white, true), spaced(8))
            addView(label("yt-dlp ${Engine.version(this@MainActivity)}\nLos sitios cambian. Mantén el motor actualizado.", 14, muted), spaced(14))
            addView(button(if (engineUpdating) "Actualizando…" else "Buscar actualizaciones").apply {
                isEnabled = !engineUpdating
                setOnClickListener {
                    if (DownloadStore.all().any { !it.terminal } || inspecting) { toast("Espera a que terminen las tareas actuales."); return@setOnClickListener }
                    engineUpdating = true; renderSettings()
                    executor.execute {
                        val result = runCatching { Engine.update(this@MainActivity) }
                        runOnUiThread {
                            if (isDestroyed) return@runOnUiThread
                            engineUpdating = false
                            result.onSuccess { toast("Motor actualizado: $it") }.onFailure { toast(Engine.friendlyError(it)) }
                            if (tab == "settings") renderSettings()
                        }
                    }
                }
            })
        }, spaced(16))
        content.addView(card().apply {
            addView(label("Segundo plano", 20, white, true), spaced(8))
            addView(label("Si HyperOS detiene las descargas con la pantalla apagada, abre los ajustes de Downlink y elige Batería → Sin restricciones. Activa también las notificaciones.", 14, muted), spaced(12))
            addView(button("Ajustes de Android").apply { setOnClickListener { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) } })
        }, spaced(20))
        content.addView(label("Downlink ${BuildConfig.VERSION_NAME} · Android 10+\nMP4 y MP3 · Sin servidor ni suscripción\n\nGuarda únicamente contenido que tengas derecho a descargar. Algunas plataformas requieren iniciar sesión o pueden limitar las descargas.", 12, muted), spaced(14))
        content.addView(button("Componentes de código abierto").apply { setOnClickListener {
            AlertDialog.Builder(this@MainActivity).setTitle("Código abierto").setMessage("youtubedl-android 0.18.1 · GPL-3.0\nhttps://github.com/yausername/youtubedl-android\n\nyt-dlp · Unlicense\nhttps://github.com/yt-dlp/yt-dlp\n\nFFmpeg · LGPL/GPL según componentes\nhttps://ffmpeg.org\n\nPython · PSF; QuickJS · MIT; AndroidX · Apache-2.0\nConsulta android/THIRD_PARTY.md en el repositorio para fuentes y licencias.").setPositiveButton("Aceptar", null).show()
        } })
    }
    private fun hideKeyboard() { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(window.decorView.windowToken, 0); window.decorView.clearFocus() }
    private fun thumbnail(url: String, job: DownloadJob? = null, title: String, compact: Boolean): FrameLayout {
        val image = ImageView(this).apply {
            contentDescription = "Vista previa de $title"
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        val frame = object : FrameLayout(this) {
            override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
                if (compact) { super.onMeasure(widthMeasureSpec, heightMeasureSpec); return }
                // Follow the image's proportions, with a height limit for tall reels.
                // FIT_CENTER also keeps the whole image visible in compact history slots.
                val drawable = image.drawable
                val aspect = if (drawable != null && drawable.intrinsicWidth > 0 && drawable.intrinsicHeight > 0)
                    drawable.intrinsicWidth.toDouble() / drawable.intrinsicHeight else 16.0 / 9.0
                val height = (MeasureSpec.getSize(widthMeasureSpec) / aspect).roundToInt().coerceIn(1, dp(280))
                super.onMeasure(widthMeasureSpec, MeasureSpec.makeMeasureSpec(resolveSize(height, heightMeasureSpec), MeasureSpec.EXACTLY))
            }
        }.apply { background = rounded(canvasColor, 14); clipToOutline = true }
        val placeholder = label("Cargando vista previa…", if (compact) 10 else 12, muted).apply { gravity = Gravity.CENTER; setPadding(dp(8), dp(8), dp(8), dp(8)) }
        frame.addView(image, FrameLayout.LayoutParams(-1, -1))
        frame.addView(placeholder, FrameLayout.LayoutParams(-1, -1))
        Thumbnails.bind(image, placeholder, url, job)
        return frame
    }
    private fun toast(message: String) { Toast.makeText(this, message, Toast.LENGTH_LONG).show() }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun vertical() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    private fun horizontal() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    private fun label(value: String, size: Int, color: Int = white, bold: Boolean = false) = TextView(this).apply {
        text = value; textSize = size.toFloat(); setTextColor(color); if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setLineSpacing(dp(3).toFloat(), 1f)
    }
    private fun rounded(color: Int, radius: Int, stroke: Int? = null) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat(); stroke?.let { setStroke(dp(1), it) }
    }
    private fun button(value: String, primary: Boolean = false) = Button(this).apply {
        text = value; isAllCaps = false; textSize = 13f; minHeight = dp(48); minimumHeight = dp(48)
        setTextColor(if (primary) canvasColor else white)
        background = rounded(if (primary) green else surface, 14)
        setPadding(dp(10), dp(8), dp(10), dp(8)); stateListAnimator = null
    }
    private fun card() = vertical().apply { background = rounded(surface, 24, border); setPadding(dp(20), dp(20), dp(20), dp(20)) }
    private fun spaced(bottom: Int, height: Int = -2) = LinearLayout.LayoutParams(-1, if (height < 0) height else dp(height)).apply { bottomMargin = dp(bottom) }
    private fun weighted() = LinearLayout.LayoutParams(0, dp(50), 1f).apply { marginStart = dp(2); marginEnd = dp(2) }
}
