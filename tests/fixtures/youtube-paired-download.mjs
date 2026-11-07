// Offline API fixture: exercise the real pairing and download routes while
// simulating a direct HTTPS request and an authorized YouTube extractor.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const configFile = path.resolve('secrets/ios-lan/config.json');
const pfxFile = path.resolve('secrets/ios-lan/server.pfx');
const exists = fs.existsSync;
const readFile = fs.readFileSync;
fs.existsSync = file => file === configFile || exists(file);
fs.readFileSync = (file, ...args) => {
  if (file === configFile) return JSON.stringify({ host: '192.0.2.1', port: 3443, passphrase: 'fixture' });
  if (file === pfxFile) return Buffer.from('synthetic-pfx');
  return readFile(file, ...args);
};

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, ...args) {
  if (event === 'request') {
    const request = args[0];
    request.socket.encrypted = request.headers['x-fixture-secure'] === 'yes';
    if (request.socket.encrypted) request.headers.host = '192.0.2.1:3443';
  }
  return emit.call(this, event, ...args);
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
    const name = path.basename(executable).toLowerCase();
    if (name.startsWith('ffprobe')) return finish(JSON.stringify({ streams: [
      { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
      { codec_type: 'audio', codec_name: 'aac' },
    ] }));
    if (name.startsWith('ffmpeg')) {
      fs.copyFileSync(args[args.indexOf('-i') + 1], args.at(-1));
      return finish('', 'progress=end\n');
    }
    if (executable !== 'youtube-paired-fixture') return finish('', 'Unexpected subprocess', 1);
    if (args.includes('--version')) return finish('fixture\n');
    if (!args.includes('--cookies')) return finish('', 'Sign in to confirm your age', 1);
    if (args.includes('--dump-single-json')) return finish(JSON.stringify({
      id: 'abcdefghijk', title: 'Restricted fixture', channel: 'Fixture', duration: 12,
      formats: [{ ext: 'mp4', vcodec: 'h264', acodec: 'aac', width: 1280, height: 720 }],
    }));
    const output = args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp4');
    fs.writeFileSync(output, 'protected youtube fixture');
    return finish('[download] 100%\n');
  });
  return proc;
};
syncBuiltinESMExports();
