# Vix TV — Apps Android

Dos aplicaciones nativas que cargan tu servidor Vix TV en un **WebView**.  
Cualquier cambio en el servidor (películas, series, diseño, trailers) se refleja **al instante** sin reinstalar la APK.

| APK | Variante Gradle | Paquete | Uso |
|-----|-----------------|---------|-----|
| **Celular** | `mobile` | `tv.vix.mobile` | Teléfono / tablet |
| **TV / TV Box** | `tv` | `tv.vix.tv` | Android TV, Fire TV, TV Box con control |

## Características

- Conectadas al servidor (`https://tv.vixred.com` por defecto, configurable)
- **Trailers con audio** en el banner superior (solo en la app nativa)
- TV: navegación con **control remoto** (flechas + OK)
- TV: interfaz ampliada y foco visible en tarjetas
- Menú / Ajustes del mando → configurar URL del servidor

## URL del servidor por defecto

`https://tv.vixred.com` — funciona desde cualquier red (datos móviles, Wi‑Fi, fuera de casa).  
Si usas tu propio servidor local, cámbiala en **Configurar servidor** dentro de la app.

## Compilar las APK

### Opción A — Docker (recomendado)

```bash
cd /root/xupertv/android
chmod +x build-apks.sh
./build-apks.sh
```

Salida:

- `app/build/outputs/apk/mobile/release/app-mobile-release.apk`
- `app/build/outputs/apk/tv/release/app-tv-release.apk`

### Opción B — Android Studio

1. Abre la carpeta `android/` en Android Studio  
2. **Build → Select Build Variant** → `mobileRelease` o `tvRelease`  
3. **Build → Build APK(s)**

### Cambiar IP por defecto al compilar

Edita `app/build.gradle`:

```gradle
buildConfigField 'String', 'DEFAULT_SERVER', '"https://tv.vixred.com"'
```

## Instalar

```bash
adb install app/build/outputs/apk/mobile/release/app-mobile-release.apk
adb install app/build/outputs/apk/tv/release/app-tv-release.apk
```

En TV Box: copia la APK `tv` a una USB e instálala, o usa `adb connect IP_TV`.

## Requisitos de red

- **Por defecto:** internet y acceso a `https://tv.vixred.com`
- **Servidor local opcional:** móvil/TV y servidor en la misma red (o VPN), puerto accesible
- HTTP local permitido (cleartext) — ya configurado en la app

## Sincronización con el servidor

La app **no embebe** el catálogo: siempre carga la web desde tu servidor.  
Actualizas Docker / archivos en `public/` → los usuarios ven los cambios al abrir o recargar la app.
