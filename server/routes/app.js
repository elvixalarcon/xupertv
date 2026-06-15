const express = require('express');
const appUpdate = require('../services/appUpdate');
const ipaInstall = require('../services/ipaInstall');
const desktopInstall = require('../services/desktopInstall');

const router = express.Router();

function requestBaseUrl(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  return `${proto}://${host}`;
}

router.get('/update', (req, res) => {
  const raw = String(req.query.platform || '').toLowerCase();
  const platform = raw === 'tv' ? 'tv' : 'mobile';
  const versionCode = req.query.version_code || 0;
  res.json(appUpdate.checkUpdate(platform, versionCode, requestBaseUrl(req)));
});

router.get('/download-links', (req, res) => {
  const base = requestBaseUrl(req).replace(/\/$/, '');
  const settings = appUpdate.getPublicSettings();
  const tvCode = settings.app_tv_version_code || 1;
  const mobileCode = settings.app_mobile_version_code || 1;
  const tvApk = appUpdate.getApkInfo('tv');
  const mobileApk = appUpdate.getApkInfo('mobile');
  const ipa = ipaInstall.getIpaInfo();
  const desktop = desktopInstall.getDesktopInfo();
  const desktopVer = desktopInstall.getAppVersionInfo();
  res.json({
    tv_apk: `${base}/apk/tv`,
    mobile_apk: `${base}/apk/mobile`,
    tv_apk_direct: `${base}/uploads/apk/VixTV-tv.apk?v=${tvCode}`,
    mobile_apk_direct: `${base}/uploads/apk/VixTV-mobile.apk?v=${mobileCode}`,
    tv_short: `${base}/d/tv`,
    mobile_short: `${base}/d/m`,
    ios_short: `${base}/d/ios`,
    ios_install: `${base}/descargar#iphone`,
    ipa_install: `${base}/ipa/install`,
    ipa_install_short: `${base}/d/ipa`,
    ipa_direct: `${base}/ipa/ios`,
    ipa_manifest: `${base}/ipa/manifest.plist`,
    ipa_itms: ipa.available ? ipaInstall.buildItmsInstallUrl(base) : null,
    ipa_available: ipa.available,
    ipa_size: ipa.size || 0,
    ipa_version: ipaInstall.getAppVersion(),
    ipa_build: ipaInstall.getAppVersionInfo().build || null,
    tv_code: `${base}/tv`,
    download_page: `${base}/descargar`,
    tv_version_name: settings.app_tv_version_name,
    tv_version_code: tvCode,
    mobile_version_name: settings.app_mobile_version_name,
    mobile_version_code: mobileCode,
    tv_apk_available: settings.app_tv_apk_available,
    mobile_apk_available: settings.app_mobile_apk_available,
    tv_apk_size: tvApk?.size || 0,
    mobile_apk_size: mobileApk?.size || 0,
    windows_setup: `${base}/desktop/setup`,
    windows_setup_direct: `${base}/uploads/desktop/VixTV-Setup.exe`,
    windows_short: `${base}/d/win`,
    windows_code: `${base}/win`,
    windows_version_name: desktopVer.version,
    windows_version_code: desktopVer.build,
    windows_setup_available: desktop.available,
    windows_setup_size: desktop.size || 0
  });
});

module.exports = router;
