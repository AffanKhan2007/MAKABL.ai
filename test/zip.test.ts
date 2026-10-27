import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { zip } from '../src/util/zip.ts';

const entries = [
  { path: 'project.json', data: Buffer.from('{"a":1}\n') },
  { path: 'code/app/page.tsx', data: Buffer.from('export default function P() {}\n') },
  { path: 'notes/ünïcode.txt', data: Buffer.from('héllo') },
  { path: 'empty.txt', data: Buffer.alloc(0) },
];

test('the archive has a local header per entry, a central directory and a valid end record', () => {
  const z = zip(entries);
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  const end = z.length - 22;
  assert.equal(z.readUInt32LE(end), 0x06054b50);
  assert.equal(z.readUInt16LE(end + 10), entries.length);
  // Walk the central directory and check every entry's name, size and CRC.
  let p = z.readUInt32LE(end + 16);
  for (const e of entries) {
    assert.equal(z.readUInt32LE(p), 0x02014b50);
    assert.equal(z.readUInt32LE(p + 16), crc32(e.data));
    assert.equal(z.readUInt32LE(p + 24), e.data.length);
    const nameLen = z.readUInt16LE(p + 28);
    assert.equal(z.subarray(p + 46, p + 46 + nameLen).toString('utf8'), e.path);
    const local = z.readUInt32LE(p + 42);
    const data = z.subarray(local + 30 + nameLen, local + 30 + nameLen + e.data.length);
    assert.deepEqual(data, e.data);
    p += 46 + nameLen;
  }
});

const temps: string[] = [];
after(async () => { for (const t of temps) await rm(t, { recursive: true, force: true }); });

// bsdtar reads zip files; GNU tar does not. Windows ships bsdtar as System32\tar.exe,
// which a Git Bash PATH can shadow with GNU tar, so prefer it explicitly.
const TAR = process.platform === 'win32' && process.env.SystemRoot
  ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
let bsdtar = false;
try { bsdtar = execFileSync(TAR, ['--version'], { encoding: 'utf8' }).includes('bsdtar'); } catch { /* skipped below */ }

test('a standard tool extracts it byte for byte', { skip: bsdtar ? false : 'bsdtar is not available' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'makabl-zip-'));
  temps.push(dir);
  await writeFile(join(dir, 'x.zip'), zip(entries));
  execFileSync(TAR, ['-xf', 'x.zip'], { cwd: dir });
  assert.equal(await readFile(join(dir, 'code/app/page.tsx'), 'utf8'), 'export default function P() {}\n');
  assert.equal(await readFile(join(dir, 'project.json'), 'utf8'), '{"a":1}\n');
});
