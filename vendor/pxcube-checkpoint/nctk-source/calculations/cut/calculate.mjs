import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const exec = promisify(execFile);
export async function calculate({ inputs, outputDir, args, runtime }) {
  const source = inputs['parts/source/house'].files[0];
  const probe = JSON.parse(await readFile(inputs['parts/probe/house'].files[0], 'utf8'));
  if (args.start + args.duration > probe.duration + 0.01) throw Error('Cut exceeds source duration');
  const output = join(outputDir, 'cut.mp4');
  await exec(runtime.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', String(args.start), '-i', source,
    '-t', String(args.duration), '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', output], { maxBuffer: 4_000_000, timeout: 300_000 });
  const { stdout } = await exec(runtime.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', output]);
  const info = JSON.parse(stdout), observed = Number(info.format?.duration);
  if (!Number.isFinite(observed) || Math.abs(observed - args.duration) > 0.35 ||
      !info.streams?.some(s => s.codec_type === 'video') || !info.streams?.some(s => s.codec_type === 'audio')) throw Error('Cut duration or streams invalid');
  await exec(runtime.ffmpeg, ['-nostdin', '-v', 'error', '-i', output, '-f', 'null', '-'], { maxBuffer: 2_000_000, timeout: 300_000 });
  return { files: [output], observation: { requestedStart: args.start, requestedDuration: args.duration, observedDuration: observed, fullDecode: 'PASS' } };
}
