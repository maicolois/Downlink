import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';

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
          formats: [
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

    const outputTemplate = args[args.indexOf('-o') + 1];
    const partialPath = outputTemplate.replace('%(ext)s', 'mp4') + '.part';
    fs.writeFileSync(partialPath, 'partial download');
    let percent = 1;
    timer = setInterval(() => {
      proc.stdout.write(`downlink-progress:${percent}%|1.0MiB/s|00:30\n`);
      percent = Math.min(percent + 1, 90);
    }, 25);
  });

  return proc;
};

syncBuiltinESMExports();
