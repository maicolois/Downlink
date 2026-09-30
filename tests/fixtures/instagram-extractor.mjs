// Test-process preload: exercise the real HTTP/job flow without contacting Instagram.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';

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
      return finish(JSON.stringify({ streams: [
        { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
        { codec_type: 'audio', codec_name: 'aac' },
      ] }));
    }
    if (executableName.startsWith('ffmpeg')) {
      const input = args[args.indexOf('-i') + 1];
      fs.copyFileSync(input, args.at(-1));
      return finish('', 'progress=end\n');
    }
    if (executable !== 'instagram-story-test-extractor') {
      return finish('', 'Unexpected subprocess in offline story test', 1);
    }
    fs.appendFileSync(process.env.STORY_FIXTURE_LOG, JSON.stringify(args) + '\n');
    const url = args.at(-1);
    if (args.includes('--version')) return finish('fixture\n');
    const cookieOption = args.indexOf('--cookies');
    const account = cookieOption >= 0
      ? /\tsessionid\t(fixture-account-\d+)/.exec(fs.readFileSync(args[cookieOption + 1], 'utf8'))?.[1]
      : null;
    if ((url.includes('/privatefixture/') || url.includes('/p/PrivatePost/')) && !account) {
      return finish('null\n', 'You need to log in to access this content', 1);
    }
    if (url.includes('/authuser/')) return finish('null\n', 'You need to log in to access this content', 1);
    const video = (id, index) => ({
      id, playlist_index: index, title: `Story ${id}`, channel: account || 'fixtureuser',
      thumbnail: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640"><rect width="360" height="640" fill="#29443f"/><circle cx="180" cy="230" r="85" fill="#718b83"/></svg>'),
      ext: 'mp4', duration: 12,
      formats: [{ ext: 'mp4', vcodec: 'h264', acodec: 'aac', width: 1080, height: 1920 }],
    });
    if (args.includes('--dump-single-json')) {
      if (url.includes('/photos/')) return finish('{"entries":[]}');
      if (url.includes('/individual/') && args.includes('--no-playlist') && !args.includes('--yes-playlist')) {
        return finish(JSON.stringify(video('Story_B', 1)));
      }
      const entries = url.includes('/missing/')
        ? [video('Story_A', 1)]
        : [video('Story_A', 1), video('Story_B', 2)];
      return finish(JSON.stringify({ _type: 'playlist', entries }));
    }
    // Simulate the selected story expiring between analysis and actual extraction.
    if (url.includes('/expired/')) return finish();
    const filter = args[args.indexOf('--match-filters') + 1];
    const post = url.includes('/p/PrivatePost/');
    const selectedId = post ? 'Story_A' : /^id = '(Story_[AB])'$/.exec(filter)?.[1];
    if (!selectedId || (!post && args.includes('--playlist-items'))) {
      return finish('', 'Expected stable story selection', 1);
    }
    // B is now first: the former index 2 would choose a different item.
    const currentEntries = ['Story_B', 'Story_A'];
    if (currentEntries.includes(selectedId)) {
      const output = args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp4');
      fs.writeFileSync(output, `offline story fixture: ${selectedId}${account ? `; ${account}` : ''}`);
    }
    finish('[download] 100%\n');
  });
  return proc;
};
syncBuiltinESMExports();
