import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sources = [
  '/var/www/html/vixmusic/config.json',
  join(root, 'config.json'),
];
const dest = join(root, 'public', 'config.json');

for (const src of sources) {
  if (existsSync(src)) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    console.log(`config.json copiado desde ${src}`);
    process.exit(0);
  }
}

console.log('Sin config.json — usa Ajustes en la app para Spotify');
