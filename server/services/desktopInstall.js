const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'data');
const DESKTOP_DIR = path.join(DATA, 'desktop');
const VERSIONS_FILE = path.join(DESKTOP_DIR, 'versions.json');
const SETUP_NAMES = ['VixTV-Setup.exe', 'VixTV-Setup-1.0.0.exe'];
const PORTABLE_NAMES = ['VixTV-Windows.zip', 'VixTV-Portable.zip'];

function ensureDir() {
  if (!fs.existsSync(DESKTOP_DIR)) fs.mkdirSync(DESKTOP_DIR, { recursive: true });
}

function readVersions() {
  if (!fs.existsSync(VERSIONS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function findPortableFile() {
  ensureDir();
  const versions = readVersions();
  if (versions && versions.portableFilename) {
    const named = path.join(DESKTOP_DIR, versions.portableFilename);
    if (fs.existsSync(named)) return { file: versions.portableFilename, full: named, type: 'zip' };
  }
  for (const name of PORTABLE_NAMES) {
    const full = path.join(DESKTOP_DIR, name);
    if (fs.existsSync(full)) return { file: name, full, type: 'zip' };
  }
  return null;
}

function findSetupFile() {
  ensureDir();
  const versions = readVersions();
  if (versions?.filename) {
    const named = path.join(DESKTOP_DIR, versions.filename);
    if (fs.existsSync(named)) return { file: versions.filename, full: named };
  }
  for (const name of SETUP_NAMES) {
    const full = path.join(DESKTOP_DIR, name);
    if (fs.existsSync(full)) return { file: name, full };
  }
  const files = fs.readdirSync(DESKTOP_DIR).filter((f) => /^VixTV-Setup.*\.exe$/i.test(f));
  if (!files.length) return null;
  files.sort((a, b) => {
    const sa = fs.statSync(path.join(DESKTOP_DIR, a));
    const sb = fs.statSync(path.join(DESKTOP_DIR, b));
    return sb.mtimeMs - sa.mtimeMs;
  });
  const file = files[0];
  return { file, full: path.join(DESKTOP_DIR, file) };
}

function getAppVersion() {
  const versions = readVersions();
  return versions?.version || versions?.versionName || '1.0.0';
}

function getAppVersionInfo() {
  const versions = readVersions();
  return {
    version: getAppVersion(),
    build: versions?.build || versions?.versionCode || null,
  };
}

function findDesktopDownload() {
  return findSetupFile() || findPortableFile();
}

function getDesktopInfo() {
  const found = findDesktopDownload();
  if (!found) return { available: false, size: 0, filename: null, type: null };
  const stat = fs.statSync(found.full);
  return {
    available: true,
    size: stat.size,
    filename: found.file,
    type: found.type || 'exe',
    mtime: stat.mtime.toISOString(),
  };
}

module.exports = {
  DESKTOP_DIR,
  VERSIONS_FILE,
  getDesktopInfo,
  getAppVersion,
  getAppVersionInfo,
  findSetupFile,
  findPortableFile,
  findDesktopDownload,
};
