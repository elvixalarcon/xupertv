#!/usr/bin/env node
/**
 * Sincroniza app_*_version_* en la BD con build.gradle / output-metadata.json
 * cuando hay APK publicado en data/apk/. Ejecutar tras build-apks.sh.
 */
const appUpdate = require('../services/appUpdate');

const changed = appUpdate.syncPublishedVersions();
if (changed.length) {
  console.log('Versiones APK sincronizadas:', changed.join(', '));
} else {
  const gradle = appUpdate.readGradleVersions();
  console.log('Sin cambios. Gradle:', gradle ? `${gradle.versionName} (${gradle.versionCode})` : 'no encontrado');
}
