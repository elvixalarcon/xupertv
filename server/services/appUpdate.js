const fs = require('fs');
const path = require('path');
const { getSetting, setSetting } = require('./settings');

const DATA = path.join(__dirname, '..', '..', 'data');
const APK_DIR = path.join(DATA, 'apk');
const GRADLE_FILE = path.join(__dirname, '..', '..', 'android', 'app', 'build.gradle');
const PUBLISHED_VERSIONS_FILE = path.join(APK_DIR, 'versions.json');
const OUTPUT_META = {
  mobile: path.join(__dirname, '..', '..', 'android', 'app', 'build', 'outputs', 'apk', 'mobile', 'release', 'output-metadata.json'),
  tv: path.join(__dirname, '..', '..', 'android', 'app', 'build', 'outputs', 'apk', 'tv', 'release', 'output-metadata.json')
};

const APK_FILES = {
  mobile: 'VixTV-mobile.apk',
  tv: 'VixTV-tv.apk'
};

function ensureApkDir() {
  if (!fs.existsSync(APK_DIR)) fs.mkdirSync(APK_DIR, { recursive: true });
}

function getApkInfo(platform) {
  ensureApkDir();
  const file = APK_FILES[platform === 'tv' ? 'tv' : 'mobile'];
  const full = path.join(APK_DIR, file);
  if (!fs.existsSync(full)) return null;
  const stat = fs.statSync(full);
  return { file, size: stat.size, mtime: stat.mtime.toISOString() };
}

function readGradleVersions() {
  if (!fs.existsSync(GRADLE_FILE)) return null;
  const text = fs.readFileSync(GRADLE_FILE, 'utf8');
  const codeMatch = text.match(/versionCode\s+(\d+)/);
  const nameMatch = text.match(/versionName\s+['"]([^'"]+)['"]/);
  if (!codeMatch) return null;
  return {
    versionCode: parseInt(codeMatch[1], 10) || 0,
    versionName: (nameMatch && nameMatch[1]) || ''
  };
}

function readOutputMetadata(platform) {
  const metaPath = OUTPUT_META[platform === 'tv' ? 'tv' : 'mobile'];
  if (!metaPath || !fs.existsSync(metaPath)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const element = Array.isArray(json.elements) ? json.elements[0] : null;
    if (!element) return null;
    return {
      versionCode: parseInt(element.versionCode, 10) || 0,
      versionName: String(element.versionName || '').trim()
    };
  } catch {
    return null;
  }
}

function readPublishedVersionsFile() {
  if (!fs.existsSync(PUBLISHED_VERSIONS_FILE)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(PUBLISHED_VERSIONS_FILE, 'utf8'));
    const normalize = (entry) => {
      if (!entry) return null;
      const versionCode = parseInt(entry.versionCode ?? entry.version_code, 10) || 0;
      const versionName = String(entry.versionName ?? entry.version_name ?? '').trim();
      if (versionCode <= 0) return null;
      return { versionCode, versionName };
    };
    return {
      mobile: normalize(json.mobile),
      tv: normalize(json.tv)
    };
  } catch {
    return null;
  }
}

/** Sincroniza versiones del panel con build.gradle / APK publicado (evita OTA silencioso). */
function syncPublishedVersions() {
  const published = readPublishedVersionsFile();
  const gradle = readGradleVersions();
  const mobileMeta = readOutputMetadata('mobile');
  const tvMeta = readOutputMetadata('tv');
  const mobileApk = getApkInfo('mobile');
  const tvApk = getApkInfo('tv');

  const mobileTarget = (published && published.mobile) || mobileMeta || gradle;
  const tvTarget = (published && published.tv) || tvMeta || gradle;
  const changed = [];

  if (mobileApk && mobileTarget && mobileTarget.versionCode > 0) {
    const storedCode = parseInt(getSetting('app_mobile_version_code', '0'), 10) || 0;
    if (mobileTarget.versionCode > storedCode) {
      setSetting('app_mobile_version_code', String(mobileTarget.versionCode));
      if (mobileTarget.versionName) {
        setSetting('app_mobile_version_name', mobileTarget.versionName);
      }
      changed.push(`mobile ${storedCode} → ${mobileTarget.versionCode}`);
    }
  }

  if (tvApk && tvTarget && tvTarget.versionCode > 0) {
    const storedCode = parseInt(getSetting('app_tv_version_code', '0'), 10) || 0;
    if (tvTarget.versionCode > storedCode) {
      setSetting('app_tv_version_code', String(tvTarget.versionCode));
      if (tvTarget.versionName) {
        setSetting('app_tv_version_name', tvTarget.versionName);
      }
      changed.push(`tv ${storedCode} → ${tvTarget.versionCode}`);
    }
  }

  return changed;
}

function getPublicSettings() {
  syncPublishedVersions();
  return {
    app_mobile_version_code: parseInt(getSetting('app_mobile_version_code', '1'), 10) || 1,
    app_mobile_version_name: getSetting('app_mobile_version_name', '1.0.0'),
    app_tv_version_code: parseInt(getSetting('app_tv_version_code', '1'), 10) || 1,
    app_tv_version_name: getSetting('app_tv_version_name', '1.0.0'),
    app_update_message: getSetting('app_update_message', 'Hay una nueva versión de Vix TV. Actualiza para obtener las últimas mejoras.'),
    app_update_force: getSetting('app_update_force', '0') === '1',
    app_mobile_apk_available: !!getApkInfo('mobile'),
    app_tv_apk_available: !!getApkInfo('tv')
  };
}

function applySettings(body) {
  if (body.app_mobile_version_code !== undefined) {
    setSetting('app_mobile_version_code', String(parseInt(body.app_mobile_version_code, 10) || 1));
  }
  if (body.app_mobile_version_name !== undefined) {
    setSetting('app_mobile_version_name', String(body.app_mobile_version_name || '1.0.0').trim());
  }
  if (body.app_tv_version_code !== undefined) {
    setSetting('app_tv_version_code', String(parseInt(body.app_tv_version_code, 10) || 1));
  }
  if (body.app_tv_version_name !== undefined) {
    setSetting('app_tv_version_name', String(body.app_tv_version_name || '1.0.0').trim());
  }
  if (body.app_update_message !== undefined) {
    setSetting('app_update_message', String(body.app_update_message || '').trim());
  }
  if (body.app_update_force !== undefined) {
    setSetting('app_update_force', body.app_update_force ? '1' : '0');
  }
}

function checkUpdate(platform, clientVersionCode, baseUrl) {
  const settings = getPublicSettings();
  const isTv = platform === 'tv';
  const targetPlatform = isTv ? 'tv' : 'mobile';
  const latestCode = isTv ? settings.app_tv_version_code : settings.app_mobile_version_code;
  const latestName = isTv ? settings.app_tv_version_name : settings.app_mobile_version_name;
  const apk = getApkInfo(targetPlatform);
  const clientCode = parseInt(clientVersionCode, 10) || 0;
  const updateAvailable = clientCode < latestCode && !!apk;
  const message = isTv
    ? (getSetting('app_tv_update_message', '') || settings.app_update_message)
    : (getSetting('app_mobile_update_message', '') || settings.app_update_message);

  return {
    update_available: updateAvailable,
    force: settings.app_update_force && updateAvailable,
    platform: targetPlatform,
    target_apk: apk?.file || null,
    version_code: latestCode,
    version_name: latestName,
    current_version_code: clientCode,
    message,
    download_url: updateAvailable ? `${baseUrl.replace(/\/$/, '')}/uploads/apk/${apk.file}?v=${latestCode}` : null,
    apk_size: apk?.size || 0
  };
}

module.exports = {
  APK_DIR,
  APK_FILES,
  getApkInfo,
  getPublicSettings,
  applySettings,
  checkUpdate,
  syncPublishedVersions,
  readGradleVersions
};
