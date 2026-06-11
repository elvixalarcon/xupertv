const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA = path.join(__dirname, '..', '..', 'data');
const IPA_DIR = path.join(DATA, 'ipa');
const IPA_FILE = 'VixTV.ipa';
const IPA_VERSIONS_FILE = path.join(IPA_DIR, 'versions.json');
const PBXPROJ = path.join(__dirname, '..', '..', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const BUNDLE_ID = 'tv.vix.app';
const APP_TITLE = 'Vix TV';

let ipaVersionCache = { mtimeMs: 0, version: '', build: '' };

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

function readVersionsJson() {
  if (!fs.existsSync(IPA_VERSIONS_FILE)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(IPA_VERSIONS_FILE, 'utf8'));
    const version = String(json.versionName || json.version || '').trim();
    const build = String(json.versionCode || json.build || '').trim();
    if (!version) return null;
    return { version, build };
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
    const version = versionMatch ? versionMatch[1] : '';
    const build = buildMatch ? buildMatch[1] : '';
    if (!version) return null;
    return { version, build };
  } catch {
    return null;
  }
}

function readIpaPlistVersion(ipaPath) {
  try {
    const plist = execSync(
      `unzip -p ${JSON.stringify(ipaPath)} Payload/App.app/Info.plist`,
      { maxBuffer: 512 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const raw = plist.toString('latin1');
    const versions = raw.match(/\d+\.\d+\.\d+/g) || [];
    const version = versions.find((v) => /^1\.0\.\d+$/.test(v)) || versions[0] || '';
    const builds = raw.match(/(?:^|[^\d])(\d{1,3})(?:[^\d]|$)/g) || [];
    const build = builds.map((b) => b.replace(/\D/g, '')).find((n) => n && Number(n) >= 1 && Number(n) <= 999) || '';
    if (!version) return null;
    return { version, build };
  } catch {
    return null;
  }
}

function getAppVersionInfo() {
  const ipaPath = getIpaPath();
  if (fs.existsSync(ipaPath)) {
    const stat = fs.statSync(ipaPath);
    if (ipaVersionCache.mtimeMs === stat.mtimeMs && ipaVersionCache.version) {
      return { version: ipaVersionCache.version, build: ipaVersionCache.build };
    }
    const fromIpa =
      readVersionsJson()
      || readIpaPlistVersion(ipaPath)
      || readPbxprojVersion();
    if (fromIpa) {
      ipaVersionCache = { mtimeMs: stat.mtimeMs, version: fromIpa.version, build: fromIpa.build || '' };
      return ipaVersionCache;
    }
  }
  const fromFile = readVersionsJson() || readPbxprojVersion();
  if (fromFile) return fromFile;
  try {
    const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
    return { version: String(pkg.version || '1.0.0'), build: '' };
  } catch {
    return { version: '1.0.0', build: '' };
  }
}

function getAppVersion() {
  return getAppVersionInfo().version || '1.0.0';
}

function absoluteUrl(base, pathname) {
  const root = String(base || '').replace(/\/$/, '');
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${root}${p}`;
}

function buildManifestPlist(baseUrl) {
  const ipaUrl = absoluteUrl(baseUrl, '/ipa/ios');
  const iconUrl = absoluteUrl(baseUrl, '/icons/icon-192.svg');
  const { version, build } = getAppVersionInfo();
  const bundleVersion = build || version;
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
        <string>${esc(bundleVersion)}</string>
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
  getAppVersionInfo,
  buildManifestPlist,
  buildItmsInstallUrl,
  absoluteUrl,
};
