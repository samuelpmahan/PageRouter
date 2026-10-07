import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from discstudio_release import make_archive, verify_archive
from root_sync import sha

class PagesReleaseTest(unittest.TestCase):
    def test_deterministic_zip_and_exact_extraction(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            dist = root / 'dist'
            dist.mkdir()
            (dist / 'index.html').write_text('<h1>DiscStudio</h1>')
            (dist / '.nojekyll').write_text('')
            (dist / 'BUILD_INFO.json').write_text(json.dumps({'artifact': 'discstudio-tournament-pages', 'static': True, 'buildId': 'test'}))
            (dist / 'assets').mkdir()
            (dist / 'assets/app.js').write_text('export default 1;')
            first, second = root / 'first.zip', root / 'second.zip'
            expected = make_archive(dist, first)
            make_archive(dist, second)
            self.assertEqual(sha(first), sha(second))
            actual, info = verify_archive(first, dist, root / 'extracted')
            self.assertEqual(actual, expected)
            self.assertEqual(info['buildId'], 'test')
            self.assertEqual(len(actual), 4)

    def test_changed_dist_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            dist = root / 'dist'
            dist.mkdir()
            (dist / 'index.html').write_text('first')
            (dist / '.nojekyll').write_text('')
            (dist / 'BUILD_INFO.json').write_text(json.dumps({'artifact': 'discstudio-tournament-pages', 'static': True, 'buildId': 'test'}))
            archive = root / 'pages.zip'
            make_archive(dist, archive)
            (dist / 'index.html').write_text('changed')
            with self.assertRaisesRegex(RuntimeError, 'differs'):
                verify_archive(archive, dist, root / 'extracted')

    def test_symlink_in_dist_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            dist = root / 'dist'
            dist.mkdir()
            (dist / 'BUILD_INFO.json').write_text('{}')
            (dist / 'linked').symlink_to('BUILD_INFO.json')
            with self.assertRaisesRegex(RuntimeError, 'unsafe dist entry'):
                make_archive(dist, root / 'pages.zip')

if __name__ == '__main__': unittest.main()
