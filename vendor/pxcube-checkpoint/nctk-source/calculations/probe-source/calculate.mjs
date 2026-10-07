import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const exec = promisify(execFile);
export async function calculate({ inputs, outputDir, runtime }) {
  const source = inputs['parts/source/house'].files[0];
  const { stdout } = await exec(runtime.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', source], { maxBuffer: 4_000_000 });
  const probe = JSON.parse(stdout);
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || !probe.streams?.some(s => s.codec_type === 'video') || !probe.streams?.some(s => s.codec_type === 'audio')) throw Error('Source has no valid A/V probe');
  const output = join(outputDir, 'probe.json');
  await writeFile(output, JSON.stringify({ duration, streams: probe.streams.map(s => ({ type: s.codec_type, codec: s.codec_name, width: s.width, height: s.height })) }, null, 2) + '\n');
  return { files: [output], observation: { duration, streams: probe.streams.length } };
}
