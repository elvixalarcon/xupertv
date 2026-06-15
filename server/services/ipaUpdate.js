const fs = require('fs');
const path = require('path');
const { getSetting, setSetting } = require('./settings');
const ipaInstall = require('./ipaInstall');

const DATA = path.join(__dirname, '..', '..', 'data');
const IPA_DIR = path.join(DATA, 'ipa');
const VERSIONS_FILE = path.join(IPA_DIR, 'versions.json');
const PBXPROJ = path.join(__dirname, '..', '..', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

function readPublishedVersions() {
  if (!fs.existsSync(VERSIONS_FILE)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8'));
    const versionCode = parseInt(json.versionCode || json.build || '0', 10) || 0;
    const versionName = String(json.versionName || json.version || '').trim();
    if (versionCode <= 0) return null;
    return { versionCode, versionName };
  } catch {
    return null;
  }
}

function readPbxprojVersion() {
  if (!fs.existsSync(PBXPROJ)) return null;
  try {
    const text = fs.readFileSync(PBXPROJ, 'utf8');
    const versionMatch = text.match(/MARKETING_VERSION = ([0-9.]+);/);
    const buildMatch = text.match(/CURRENT_PROJECT_VERSION = ([0-9]+);/);
    const versionName = versionMatch ? versionMatch[1] : '';
    const versionCode = buildMatch ? parseInt(buildMatch[1], 10) : 0;
    if (versionCode <= 0) return null;
    return { versionCode, versionName };
  } catch {
    return null;
  }
}

function pickNewestVersion(...candidates) {
  let best = null;
  for (const cur of candidates) {
    if (!cur || !cur.versionCode) continue;
    if (!best || cur.versionCode > best.versionCode) {
      best = { versionCode: cur.versionCode, versionName: cur.versionName || best?.versionName || '' };
    }
  }
  return best;
}

function syncPublishedVersions() {
  const ipa = ipaInstall.getIpaInfo();
  if (!ipa.available) return [];
  const target = pickNewestVersion(readPublishedVersions(), readPbxprojVersion());
  if (!target) return [];
  const storedCode = parseInt(getSetting('app_ios_version_code', '0'), 10) || 0;
  if (target.versionCode <= storedCode) return [];
  setSetting('app_ios_version_code', String(target.versionCode));
  if (target.versionName) setSetting('app_ios_version_name', target.versionName);
  return [`ios ${storedCode} → ${target.versionCode}`];
}

function getPublicSettings() {
  syncPublishedVersions();
  return {
    app_ios_version_code: parseInt(getSetting('app_ios_version_code', '1'), 10) || 1,
    app_ios_version_name: getSetting('app_ios_version_name', '1.0.0'),
    app_ios_update_message: getSetting('app_ios_update_message', '')
      || getSetting('app_update_message', 'Hay una nueva versión de Vix TV. Actualiza para obtener las últimas mejoras.'),
    app_ios_ipa_available: !!ipaInstall.getIpaInfo().available
  };
}

function checkUpdate(clientVersionCode, baseUrl) {
  const settings = getPublicSettings();
  const ipa = ipaInstall.getIpaInfo();
  const clientCode = parseInt(clientVersionCode, 10) || 0;
  const latestCode = settings.app_ios_version_code;
  const latestName = settings.app_ios_version_name;
  const updateAvailable = clientCode < latestCode && ipa.available;
  const root = String(baseUrl || '').replace(/\/$/, '');

  return {
    update_available: updateAvailable,
    force: false,
    platform: 'ios',
    version_code: latestCode,
    version_name: latestName,
    current_version_code: clientCode,
    message: settings.app_ios_update_message,
    download_url: updateAvailable ? `${root}/ipa/install` : null,
    install_url: updateAvailable ? `${root}/ipa/install` : null,
    ipa_url: updateAvailable ? `${root}/ipa/ios` : null,
    itms_install: updateAvailable ? ipaInstall.buildItmsInstallUrl(root) : null,
    ipa_size: ipa.size || 0
  };
}

module.exports = {
  syncPublishedVersions,
  getPublicSettings,
  checkUpdate
};
