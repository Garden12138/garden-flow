import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const localRequire = createRequire(import.meta.url);

export function musicNormalizationGain(meanDb: number, peakDb: number): number {
  if (!Number.isFinite(meanDb) || !Number.isFinite(peakDb) || meanDb >= -32) return 0;
  return Math.max(0, Math.min(24, -18 - meanDb, -1.5 - peakDb));
}

function ffmpegPath(): string {
  const binary = localRequire('ffmpeg-static') as string | null;
  if (!binary) throw new Error('内置 ffmpeg 不可用');
  return binary.replace('app.asar', 'app.asar.unpacked');
}

async function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-24000); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stderr) : reject(new Error(`BGM 音量处理失败 (${code}): ${stderr.slice(-500)}`)));
  });
}

export async function normalizeQuietMusic(sourcePath: string, targetPath: string): Promise<{ outputPath: string; gainDb: number }> {
  const report = await runFfmpeg(['-hide_banner', '-i', sourcePath, '-af', 'volumedetect', '-f', 'null', '-']);
  const meanDb = Number(/mean_volume:\s*(-?[\d.]+) dB/.exec(report)?.[1]);
  const peakDb = Number(/max_volume:\s*(-?[\d.]+) dB/.exec(report)?.[1]);
  const gainDb = musicNormalizationGain(meanDb, peakDb);
  if (gainDb < 1) return { outputPath: sourcePath, gainDb: 0 };
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.tmp.mp3`;
  try {
    await runFfmpeg(['-hide_banner', '-y', '-i', sourcePath, '-vn', '-af', `volume=${gainDb.toFixed(2)}dB`, '-c:a', 'libmp3lame', '-q:a', '2', temporaryPath]);
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
  return { outputPath: targetPath, gainDb };
}
