import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';

const realFetch = globalThis.fetch;
let extractionCount = 0;
globalThis.fetch = (url, options) => String(url).includes('.googlevideo.com/')
  ? Promise.resolve(new Response(null, { headers: { 'x-head-seqnum': '5' } }))
  : realFetch(url, options);
childProcess.spawn = (executable, args) => {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = () => true;
  queueMicrotask(() => {
    let code = 0;
    if (String(executable).toLowerCase().includes('ffprobe')) {
      proc.stdout.end(JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' }] }));
    } else if (String(executable).toLowerCase().includes('ffmpeg')) {
      fs.writeFileSync(args.at(-1), 'fixture compatible mp4');
      proc.stdout.end('');
    } else if (args.includes('--version')) proc.stdout.end('fixture\n');
    else if (args.includes('--load-info-json')) {
      const infoFile = args[args.indexOf('--load-info-json') + 1];
      const output = args[args.indexOf('-o') + 1];
      const partial = output.replace('%(ext)s', 'f160.mp4.part');
      const snapshot = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
      fs.appendFileSync(process.env.YOUTUBE_RETRY_LOG, JSON.stringify({ infoFile, partial, exists: fs.existsSync(partial),
        token: snapshot.formats[0].extra_param_to_segment_url,
        count: snapshot.formats[0].fragments.length, last: snapshot.formats[0].fragments.at(-1).path }) + '\n');
      if (fs.existsSync(`${process.env.YOUTUBE_RETRY_LOG}.succeed`)) {
        fs.rmSync(partial, { force: true });
        fs.writeFileSync(output.replace('%(ext)s', 'mp4'), 'fixture mp4');
        proc.stdout.end('');
      } else {
        fs.writeFileSync(partial, 'partial video');
        proc.stderr.end('ERROR: fragment 7 not found, HTTP Error 401\n');
        code = 1;
      }
    } else if (args.includes('--dump-single-json')) {
      if (args.includes('--live-from-start')) extractionCount++;
      proc.stdout.end(JSON.stringify({
        id: 'livefixture', title: 'Live fixture', is_live: true, live_status: 'is_live',
        release_timestamp: Math.floor(Date.now() / 1000) - 60,
        formats: [{ format_id: '160', protocol: 'http_dash_segments_generator',
          url: `https://a.googlevideo.com/video?token=secret${extractionCount}`, ext: 'mp4', vcodec: 'avc1',
          acodec: 'none', width: 256, height: 144 }],
      }));
    } else proc.stdout.end('');
    setImmediate(() => proc.emit('close', code));
  });
  return proc;
};
syncBuiltinESMExports();
