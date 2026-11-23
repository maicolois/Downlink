# DOWNLINK omite fragmentos disponibles de Twitch y borra la descarga al verificarla

Incidencia reproducida el 19 de noviembre de 2026 en Windows con DOWNLINK 1.2.0. Caso real de [DjMaRiiO en Twitch](https://www.twitch.tv/videos/2932168999). Impacto observado en un VOD de 16 h 20 min. En la misma tanda se completaron otro directo de Twitch y tres vídeos de YouTube.

## Qué ve el usuario

Seleccionar MP4, calidad máxima, destino original y esperar a la verificación final. El trabajo 2b8c6ffa-2bf9-4ccd-aca5-fea67673aeef llegó al 99 % y mostró este mensaje.

> La descarga de Twitch quedó incompleta (58781 de 58840 segundos).

Tras el error, el MP4 desapareció del directorio de descargas de DOWNLINK. El estado indicaba la diferencia de duración, sin ofrecer los intervalos afectados ni un reintento parcial.

## Qué falló

El manifiesto oficial de 1080p60 contiene 5.873 fragmentos y anuncia 58.840,501 s. El preparador de Twitch de DOWNLINK eligió seis direcciones alternativas para seis segmentos que Twitch publica con la indicación de audio silenciado. En la comprobación posterior, las seis alternativas devolvieron HTTP 403 al cliente de descarga. Los seis fragmentos publicados por Twitch respondieron HTTP 200 y conservaron la imagen.

| Índices del manifiesto (desde cero) | Intervalo del directo | Imagen en la fuente publicada |
| --- | --- | --- |
| 2484 y 2485 | 6 h 54 min 41,550 s a 6 h 55 min 01,550 s | Dos fragmentos de 10 s |
| 2572 a 2575 | 7 h 09 min 24,100 s a 7 h 10 min 04,100 s | Cuatro fragmentos de 10 s |

## Reproducción corta con el motor incluido en DOWNLINK

Extraer del manifiesto de 1080p los índices 2483 a 2486. Formar una lista de cuatro fragmentos, conservando el orden, y descargarla con el ejecutable yt-dlp incluido en la aplicación. Para contrastar, repetir con las cuatro direcciones que entrega buildTwitchUnmutedPlaylist. Se usaron cero reintentos para que el fallo de la muestra fuera inmediato.

| Lista entregada al motor | Manejo de fragmentos ausentes | Resultado observado después de pasar a MP4 |
| --- | --- | --- |
| Cuatro direcciones publicadas por Twitch | Interrumpir al fallar | Éxito. 40,013 s de vídeo |
| Cuatro direcciones preparadas por DOWNLINK | Omitir al fallar | Éxito aparente. 20,014 s de vídeo. El motor registró que omitió los fragmentos 2 y 3 de esta muestra |
| Cuatro direcciones preparadas por DOWNLINK | Interrumpir al fallar | Error HTTP 403 en el fragmento 2 |

La prueba reproduce la pérdida antes de la verificación final. El margen de 30 s de la función isDownloadDurationComplete detectó la pérdida acumulada en el directo largo. En un vídeo en el que solo falten esos dos fragmentos de la muestra, el mismo margen permitiría aceptar un archivo al que le faltan 20 s.

## Dónde corregirlo

- En server/platforms/twitch/twitch-unmute.js, conservar la dirección publicada junto a cada alternativa. Si al descargar la alternativa falla, recuperar el mismo fragmento desde la dirección publicada. Un fragmento con el audio silenciado conserva la imagen y el tiempo del directo.
- En server/index.js, evitar que el motor descarte un fragmento de Twitch sin comunicarlo al trabajo. Registrar índice, duración y resultado, y verificar que el último índice esperado se recibió junto con los anteriores.
- En failDownloadJob, conservar temporalmente los datos válidos de los VOD de Twitch cuando la descarga sea recuperable. Permitir reintentar los fragmentos pendientes o descartar el trabajo. El flujo actual reserva esa recuperación para trabajos con liveSnapshotData.
- Mantener la verificación de duración como comprobación adicional. Incluir en el error tanto el intervalo como la causa y distinguir un fragmento silenciado que sí se descargó de un fragmento perdido.

## Pruebas de aceptación

1. Alternativa HTTP 403, original HTTP 200. Recuperar los cuatro fragmentos de la muestra, producir alrededor de 40 s y conservar el orden.
2. Ambas direcciones fallan. Mostrar el índice, conservar los demás fragmentos y reintentar únicamente el pendiente.
3. Falta un único fragmento de 10 s. Detectarlo aunque la diferencia esté dentro del margen de 30 s.
4. Todas las direcciones funcionan. Conservar la duración, resolución y sonido disponibles en la fuente y permitir la descarga normal.


## Resultado de la recuperación

Se conservaron los seis fragmentos oficiales de Twitch en los intervalos afectados y se recuperaron los 5.873 fragmentos en orden con el motor incluido en DOWNLINK. El MP4 final mide 45.324.987.667 bytes, contiene vídeo de 1920 × 1080 y audio AAC estéreo, y dura 58.840,517 s. La diferencia respecto al manifiesto es de 16 milisegundos. Se comprobó la reproducción al principio, durante la visita y al final, además de seis muestras alrededor de los intervalos recuperados. El archivo conserva el audio tal como Twitch lo publica en esos intervalos.
