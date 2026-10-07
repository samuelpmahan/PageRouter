// Base chunks provide the application. This delta only changes the owning
// workspace identity; the resulting cartridge has its own browser storage.
import fs from 'node:fs';
const source = JSON.parse(fs.readFileSync('../../vendor/studio/SOURCE.json', 'utf8'));
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/config.mjs', `export default ${JSON.stringify({
  id: 'upload-disc-to-shelf-delta', title: 'UploadDiscToShelf Delta',
  mode: 'upload', source: source.commit,
})};\n`);
