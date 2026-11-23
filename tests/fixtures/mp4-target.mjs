import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === 'mp4-target.twitch.test') {
    return Promise.resolve(new Response(`#EXTM3U\n#EXTINF:60,\n0.ts\n${url.pathname.includes('/frozen/') ? '' : '#EXT-X-ENDLIST\n'}`));
  }
  return realFetch(input, init);
};

childProcess.spawn = (executable, args) => {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = () => true;
  queueMicrotask(() => {
    const finish = (stdout = '', stderr = '', code = 0) => {
      proc.stdout.end(stdout);
      proc.stderr.end(stderr);
      proc.emit('close', code);
    };
    const executableName = path.basename(executable).toLowerCase();
    if (executableName.startsWith('ffprobe')) {
      const input = args.at(-1);
      const contents = fs.readFileSync(input, 'utf8');
      if (args.includes('format=duration')) return finish(contents.includes('short') ? '20' : '60');
      if (contents.includes('no-video')) return finish(JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'aac' }] }));
      return finish(JSON.stringify({ streams: [
        { codec_type: 'video', codec_name: 'hevc', pix_fmt: 'yuv420p' },
        { codec_type: 'audio', codec_name: 'aac' },
      ] }));
    }
    if (executableName.startsWith('ffmpeg')) {
      fs.appendFileSync(process.env.MP4_TARGET_LOG, 'converted\n');
      fs.writeFileSync(args.at(-1), 'compatible-fixture');
      return finish('', 'progress=end\n');
    }
    if (executable !== 'mp4-target-fixture') return finish('', 'Unexpected subprocess', 1);
    if (args.includes('--version')) return finish('fixture\n');
    if (args.includes('--dump-single-json')) {
      const url = args.at(-1);
      const twitch = url.includes('twitch.tv');
      const twitchVod = twitch && url.includes('/videos/');
      const rendition = url.includes('1234567891') ? 'normal' : url.includes('1234567892') ? 'frozen' : 'short';
      return finish(JSON.stringify({
        id: 'fixture1234', title: 'Target fixture', channel: 'Fixture', duration: 60,
        formats: twitchVod
          ? [{ format_id: '720p', ext: 'mp4', vcodec: 'hevc', acodec: 'aac', width: 1280, height: 720,
              protocol: 'm3u8_native', url: `https://mp4-target.twitch.test/vod/${rendition}/index-dvr.m3u8` }]
          : [{ format_id: '720p', ext: 'mp4', vcodec: 'hevc', acodec: 'aac', width: 1280, height: 720 }],
      }));
    }
    if (process.env.MP4_FORMAT_LOG) fs.appendFileSync(process.env.MP4_FORMAT_LOG, `${JSON.stringify(args)}\n`);
    const output = args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp4');
    fs.writeFileSync(output, args.at(-1).includes('/short/') ? 'original-short' : 'original-fixture');
    return finish('[download] 100%\n');
  });
  return proc;
};
syncBuiltinESMExports();
