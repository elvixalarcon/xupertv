# Vix TV — iPhone / iPad

## ¿Se puede descargar un IPA desde el navegador?

**No**, igual que un APK en Android. Apple no permite instalar archivos `.ipa` tocando un enlace en Safari.

Opciones reales:

| Método | Requisitos | Para tus usuarios |
|--------|------------|-------------------|
| **PWA (pantalla de inicio)** | Solo Safari | ✅ Recomendado — `/descargar#iphone` |
| **eSign + IPA** | Compilar IPA una vez (Mac o GitHub Actions) + eSign en iPhone | App nativa sin App Store — ver `ESIGN.md` |
| **TestFlight** | Mac, Xcode, Apple Developer ($99/año) | Beta limitada, app nativa |
| **App Store** | Revisión Apple | Distribución pública oficial |

La web de Vix TV ya está preparada como PWA (`manifest.json`, iconos, meta tags iOS).

## Instalación para usuarios (PWA)

1. Abrir en Safari: `https://tv.vixred.com/d/ios`
2. Compartir → **Añadir a pantalla de inicio**
3. Abrir Vix TV desde el icono del inicio

## IPA nativo con Capacitor (Mac)

El proyecto ya incluye Capacitor configurado. Ver **`CAPACITOR.md`**:

```bash
cd xupertv
npm install
npx cap sync ios
npx cap open ios
```

**Este servidor Linux no puede compilar IPAs** — usa `ios/build-ipa-unsigned.sh` en Mac o GitHub Actions (`.github/workflows/ios-ipa.yml`). **eSign** firma el IPA en el iPhone sin Mac. Ver **`ESIGN.md`**.

## Enlaces públicos

- Instrucciones iPhone: `/descargar#iphone`
- Atajo: `/d/ios` o `/iphone`
