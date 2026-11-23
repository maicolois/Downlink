import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === 'fixture.twitch.test') {
    return Promise.resolve(new Response('#EXTM3U\n#EXTINF:60,\n0.ts\n#EXT-X-ENDLIST\n'));
  }
  return realFetch(input, init);
};

childProcess.spawn = (executable, args) => {
  if (executable !== 'cancellable-test-extractor') {
    throw new Error(`Unexpected subprocess in cancellation test: ${executable}`);
  }

  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.exitCode = null;
  let timer = null;
  let closed = false;

  const close = code => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    proc.exitCode = code;
    proc.stdout.end();
    proc.stderr.end();
    queueMicrotask(() => proc.emit('close', code));
  };

  proc.kill = () => {
    close(1);
    return true;
  };

  queueMicrotask(() => {
    if (args.includes('--version')) {
      proc.stdout.write('fixture\n');
      close(0);
      return;
    }

    if (args.includes('--dump-single-json')) {
      const sendMetadata = () => {
        proc.stdout.write(JSON.stringify({
          id: 'abcdefghijk',
          title: 'Cancellable fixture',
          channel: 'Fixture',
          duration: 60,
          thumbnail: '',
          formats: args.at(-1).includes('twitch.tv')
            ? [{ ext: 'mp4', vcodec: 'h264', acodec: 'aac', width: 1920, height: 1080,
                protocol: 'm3u8_native', url: 'https://fixture.twitch.test/vod/chunked/index-dvr.m3u8' }]
            : [
                { ext: 'mp4', vcodec: 'h264', acodec: 'none', width: 1920, height: 1080 },
                { ext: 'm4a', vcodec: 'none', acodec: 'aac' }
              ]
        }));
        close(0);
      };
      if (args.at(-1).includes('slowmetadata=1')) timer = setTimeout(sendMetadata, 1_000);
      else sendMetadata();
      return;
    }

    if (args.at(-1).includes('fixture_error=age')) {
      proc.stderr.write('ERROR: [youtube] Sign in to confirm your age\n');
      close(1);
      return;
    }

    const outputTemplate = args[args.indexOf('-o') + 1];
    const partialPath = outputTemplate.replace('%(ext)s', 'mp4') + '.part';
    fs.writeFileSync(partialPath, 'partial download');
    let percent = 1;
    timer = setInterval(() => {
      if (args.includes('--downloader')) {
        // Child-process chunks can split both FFmpeg keys and values.
        proc.stderr.write('total_si');
        proc.stderr.write('ze=3000000\r\nout_time=00:00:');
        proc.stderr.write('15.000000\r\nspeed= 2x\r\nprogress=continue\r\n');
        return;
      }
      proc.stdout.write(`downlink-progress:${percent}%|1.0MiB/s|00:30\n`);
      percent = Math.min(percent + 1, 90);
    }, 25);
  });

  return proc;
};

syncBuiltinESMExports();
