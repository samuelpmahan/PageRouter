import { buildStudio } from '../../local/build-studio.mjs';
import { loadManifest } from '../../crisp/lib/manifest.mjs';
buildStudio(await loadManifest(process.cwd()));
