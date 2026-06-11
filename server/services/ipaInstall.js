const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
const IPA_DIR = path.join(DATA, 'ipa');
const IPA_FILE = 'VixTV.ipa';
const BUNDLE_ID = 'tv.vix.app';
const APP_TITLE = 'Vix TV';

function getIpaPath() {
  return path.join(IPA_DIR, IPA_FILE);
}

function getIpaInfo() {
  const full = getIpaPath();
  if (!fs.existsSync(full)) {
    return { available: false, size: 0, filename: IPA_FILE };
  }
  const stat = fs.statSync(full);
  return { available: true, size: stat.size, filename: IPA_FILE, mtime: stat.mtime };
}

function getAppVersion() {
  try {
    const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
    return String(pkg.version || '1.0.0');
  } catch {
    return '1.0.0';
  }
}

function absoluteUrl(base, pathname) {
  const root = String(base || '').replace(/\/$/, '');
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${root}${p}`;
}

function buildManifestPlist(baseUrl) {
  const ipaUrl = absoluteUrl(baseUrl, '/ipa/ios');
  const iconUrl = absoluteUrl(baseUrl, '/icons/icon-192.svg');
  const version = getAppVersion();
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${esc(ipaUrl)}</string>
        </dict>
        <dict>
          <key>kind</key>
          <string>display-image</string>
          <key>url</key>
          <string>${esc(iconUrl)}</string>
        </dict>
        <dict>
          <key>kind</key>
          <string>full-size-image</string>
          <key>url</key>
          <string>${esc(iconUrl)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${esc(BUNDLE_ID)}</string>
        <key>bundle-version</key>
        <string>${esc(version)}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${esc(APP_TITLE)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;
}

function buildItmsInstallUrl(baseUrl) {
  const manifest = absoluteUrl(baseUrl, '/ipa/manifest.plist');
  return `itms-services://?action=download-manifest&url=${encodeURIComponent(manifest)}`;
}

module.exports = {
  IPA_FILE,
  BUNDLE_ID,
  APP_TITLE,
  getIpaInfo,
  getAppVersion,
  buildManifestPlist,
  buildItmsInstallUrl,
  absoluteUrl,
};
