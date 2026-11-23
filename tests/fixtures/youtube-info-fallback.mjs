import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';

childProcess.spawn = (executable, args) => {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = () => true;
  queueMicrotask(() => {
    fs.appendFileSync(process.env.YOUTUBE_FIXTURE_LOG, JSON.stringify(args) + '\n');
    let code = 0;
    if (args.includes('--version')) proc.stdout.end('fixture\n');
    else if (args.at(-1).includes('autherror')) {
      proc.stderr.end('Sign in to confirm your age'); code = 1;
    } else if (args.at(-1).includes('livefixture') && args.includes('youtube:skip=hls,dash')) {
      proc.stderr.end('ERROR: No video formats found!'); code = 1;
    } else proc.stdout.end(JSON.stringify({
      id: 'livefixture', title: 'Live fixture', is_live: true,
      formats: [{ ext: 'mp4', vcodec: 'h264', acodec: 'none', width: 1280, height: 720 }],
    }));
    proc.emit('close', code);
  });
  return proc;
};
syncBuiltinESMExports();
