# Vix TV — App iOS con Capacitor

Proyecto nativo iOS (WKWebView) que carga la web de Vix TV. **La compilación del IPA requiere macOS + Xcode.**

## Requisitos

- Mac con Xcode 15+
- Cuenta [Apple Developer](https://developer.apple.com/programs/) (TestFlight / App Store)
- Node.js 18+

## Instalación (en Mac)

```bash
cd xupertv
npm install
npx cap sync ios
npx cap open ios
```

En Xcode:

1. Selecciona el target **App**
2. **Signing & Capabilities** → tu Team
3. **Product → Archive** → distribuir por TestFlight o App Store

## Cambiar servidor

Edita `capacitor.config.json` en la raíz del proyecto:

```json
"server": {
  "url": "https://tu-servidor.com"
}
```

Luego `npx cap sync ios`.

## Desarrollo local

Para apuntar al servidor de esta máquina:

```json
"server": {
  "url": "http://IP-LAN:80",
  "cleartext": true
}
```

## Notas

- El binario IPA **no se genera en Linux**; este repo incluye el proyecto Xcode listo para abrir en Mac.
- Los usuarios sin Mac pueden seguir usando la **PWA** en Safari (`/descargar#iphone`).
