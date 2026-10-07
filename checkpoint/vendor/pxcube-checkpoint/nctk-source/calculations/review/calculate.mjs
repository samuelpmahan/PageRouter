import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative } from 'node:path';

const exec = promisify(execFile);
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export async function calculate({ inputs, outputDir, args, viewArgs, runtime }) {
  const cut = inputs['parts/cut/house'].files[0];
  const image = join(outputDir, 'thumbnail.jpg'), html = join(outputDir, 'review.html');
  await exec(runtime.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', '2', '-i', cut, '-frames:v', '1', '-q:v', '2', '-y', image]);
  const videoUrl = relative(outputDir, cut).replaceAll('\\', '/');
  await writeFile(html, `<!doctype html><html lang="en"><meta charset="utf-8"><title>${esc(viewArgs.title)}</title>
<style>body{font:16px system-ui;max-width:900px;margin:2rem auto;background:#17191c;color:#eee}video,img{display:block;max-width:100%;margin:1rem 0}small{color:#bbb}</style>
<h1>${esc(viewArgs.title)}</h1><video controls preload="metadata" src="${esc(videoUrl)}"></video><img src="thumbnail.jpg" alt="Frame from this clip">
<p>Source eSqt7amQyAo · start ${args.start}s · requested length ${args.duration}s</p><small>Mechanical review. Editorial acceptance is pending.</small></html>\n`);
  return { files: [html, image], observation: { title: viewArgs.title, video: cut } };
}
