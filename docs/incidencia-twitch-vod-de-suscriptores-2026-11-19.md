# DOWNLINK muestra un error genérico para un directo de Twitch reservado a suscriptores

Observado el 19 de noviembre de 2026 en DOWNLINK 1.2.0 para Windows durante la revisión del [directo de Folagor](https://www.twitch.tv/videos/2932253145).

## Reproducción

1. Enviar el enlace del directo a POST /api/info en la instancia local.
2. La aplicación responde HTTP 500 y muestra «No se pudo obtener el vídeo. Comprueba que el enlace sea público y esté disponible.» Se observó en dos intentos.
3. Analizar el mismo enlace con el motor yt-dlp incluido en la aplicación. El motor identifica expresamente que el archivo completo requiere una cuenta con acceso a contenido de suscriptores.

Como control, el motor sí descargó a 2560 × 1440 un [clip público del mismo directo](https://clips.twitch.tv/CuteDarkBatMcaT-EYN4GioG8HE6oX9t). El clip dura 30,016 segundos.

## Mejora propuesta

Cuando el proveedor identifique expresamente el requisito de suscripción, distinguir ese estado de una caída del servicio, de un vídeo eliminado y de un fallo de red. Informar al usuario de la restricción de acceso y conservar la causa en el diagnóstico. Probar el caso junto a un clip público del mismo directo para evitar aplicar la restricción a todo el canal.
