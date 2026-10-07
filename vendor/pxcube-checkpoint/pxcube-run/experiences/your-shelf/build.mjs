import { buildStudio } from '../../local/build-studio.mjs';

// Your Shelf deliberately mounts the existing shelf surface so its retained
// collection and bag semantics stay owned by Studio rather than being copied.
buildStudio();
