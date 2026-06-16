# VixMusic

Reproductor de **música libre de derechos** con interfaz tipo **Spotify**. Usa la API oficial de [Jamendo](https://www.jamendo.com) (Creative Commons).

- Buscar y reproducir en vivo
- Descargar **solo** cuando el artista lo permite (`CC ✓`)
- Biblioteca local offline en el dispositivo
- App web, PWA y proyecto **APK** (Android) sin Play Store

## Requisito: Client ID de Jamendo

1. Entra en [devportal.jamendo.com](https://devportal.jamendo.com/)
2. Crea una aplicación (gratis)
3. Copia el **Client ID**
4. En la app: **Ajustes** → pega el ID → Guardar

Sin esto la app no puede buscar ni reproducir.

## Probar en el navegador (PC o móvil)

```bash
cd /root/vixmusic
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
npm install
npm run dev
```

Abre la URL que muestra Vite (ej. `http://TU_IP:5173`).

Build producción:

```bash
npm run build
npm run preview
```

## Generar APK (Android, sin Google Play)

Necesitas en tu PC:

- [Node.js 20+](https://nodejs.org/)
- [Android Studio](https://developer.android.com/studio) (SDK + JDK)

```bash
cd vixmusic
npm install
npm run cap:sync
npx cap open android
```

En Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`.

Pásalo al teléfono e instálalo (permitir “orígenes desconocidos”).

### Descargas offline en el APK

En la app Android (Capacitor), las canciones que descargues con el botón **↓** se guardan en el **almacenamiento interno del teléfono** (no en el navegador). Luego puedes escucharlas sin internet desde **Descargas**.

1. Con WiFi/datos, busca una canción y pulsa **↓** en el reproductor.
2. Ve a **Descargas** y confirma que aparece.
3. Activa modo avión y reproduce desde esa lista.

`npm run cap:sync` usa un build especial para móvil (`build:cap`) y copia `config.json` de Spotify si existe en el servidor.

### APK release (firmado, sin aviso de depuración)

```bash
cd android
./gradlew assembleRelease
```

El APK firmado queda en `android/app/build/outputs/apk/release/app-release.apk`.

Credenciales de firma: ver `android/KEYSTORE-INFO.txt` (guárdalas; son necesarias para actualizaciones).

Descarga directa (si está publicado en el servidor): `http://TU_IP/vixmusic/VixMusic-release.apk`

### Instalar APK por USB

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

### IPA iPhone (sin App Store)

La IPA se compila en **GitHub Actions** (macOS) con el workflow `vixmusic-ios-ipa.yml` del repo [xupertv](https://github.com/elvixalarcon/xupertv).

```bash
# En el servidor con gh autenticado (ej. 5.5.5.19), tras cambios en vixmusic/:
cd xupertv && git push origin main
# O manualmente: Actions → VixMusic iOS IPA → Run workflow
```

Descarga:

- Servidor: `http://TU_IP/vixmusic/VixMusic.ipa`
- GitHub Release: tag `vixmusic-ios-v1.0`

Instalar con **eSign**, **AltStore** o **Sideloadly** (IPA sin firmar; hay que firmarla con tu Apple ID).

## Estructura

| Carpeta | Uso |
|---------|-----|
| `src/api/jamendo.js` | Búsqueda, streaming, descargas API |
| `src/lib/downloads.js` | Biblioteca local (IndexedDB) |
| `src/views/` | Inicio, Buscar, Biblioteca |
| `android/` | Proyecto nativo Capacitor (tras `cap add android`) |

## Licencias

- La música viene de **Jamendo**; cada pista tiene su licencia CC (enlace en metadatos).
- No incluye catálogo de Spotify ni descargas no autorizadas.
- Respeta `audiodownload_allowed`: si el artista no permite descarga, solo **stream**.

## Nombre y paquete

- App: **VixMusic**
- ID Android: `com.vixmusic.app` (editable en `capacitor.config.json`)
