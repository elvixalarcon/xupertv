# Vix TV en iPhone con eSign (sin Mac)

## Qué hace cada cosa

| Paso | Dónde | Qué necesitas |
|------|--------|----------------|
| **1. Crear el .ipa** | macOS o GitHub Actions | Compilar el proyecto (no se puede en Linux) |
| **2. Firmar e instalar** | Tu iPhone con **eSign** | Certificado (.p12) o cuenta vinculada en eSign |

**eSign no compila la app** — solo firma un `.ipa` que ya existe.

## Opción A — GitHub Actions (sin Mac)

1. Sube el repo a GitHub.
2. Ve a **Actions → iOS IPA (unsigned) → Run workflow**.
3. Al terminar, descarga el artefacto **VixTV-unsigned-ipa**.
4. Copia `VixTV.ipa` al servidor:
   ```bash
   cp VixTV.ipa /ruta/xupertv/data/ipa/VixTV.ipa
   ```
5. Los usuarios descargan: `https://tv.vixred.com/ipa/ios`

## Opción B — Mac (una vez)

```bash
cd xupertv
chmod +x ios/build-ipa-unsigned.sh
./ios/build-ipa-unsigned.sh
```

Genera `data/ipa/VixTV.ipa`.

## Instalar con eSign en el iPhone

1. Instala **eSign** (Tienda alternativa / fuente que uses).
2. Importa tu certificado (.p12 + contraseña) en eSign si aún no lo tienes.
3. Descarga el IPA en el iPhone (Safari → `https://tv.vixred.com/ipa/ios`).
4. **Compartir → Abrir en eSign** (o importar desde Archivos).
5. En eSign: selecciona el IPA → **Firmar** → **Instalar**.
6. Ajustes → General → VPN y gestión de dispositivos → confiar en el desarrollador.

## Renovación

Los certificados de sideload suelen durar **7–365 días** según el tipo. Cuando expire, vuelve a firmar el mismo IPA en eSign (o descarga uno nuevo si actualizaste la app).

## Alternativa sin IPA: PWA

Para usuarios sin eSign: Safari → `https://tv.vixred.com/d/ios` → **Añadir a pantalla de inicio**.
