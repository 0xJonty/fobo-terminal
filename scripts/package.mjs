#!/usr/bin/env node
/**
 * Build a Chrome Web Store upload: `npm run package`.
 *
 * Runs the checked build into ./dist (ignoring FOBO_OUT_DIR, so a Windows-side dev directory
 * is never what gets shipped), then zips it with manifest.json at the archive root — which is
 * what the store expects — leaving out the .map files (hidden sourcemaps are for local
 * debugging; the store package should not carry readable source).
 *
 * No dependencies: a minimal ZIP writer (deflate via node:zlib) is enough for a ~0.5 MB
 * package and keeps the tree free of packaging-only modules.
 */

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { deflateRawSync } from 'node:zlib'

const root = resolve(new URL('..', import.meta.url).pathname)
const dist = join(root, 'dist')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

execSync('npm run build', { cwd: root, stdio: 'inherit', env: { ...process.env, FOBO_OUT_DIR: 'dist' } })

/* ---------- minimal zip ---------- */

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let crc = 0xffffffff
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function zip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  const { time, day } = dosDateTime(new Date())

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const deflated = deflateRawSync(data, { level: 9 })
    const stored = deflated.length >= data.length
    const body = stored ? data : deflated
    const method = stored ? 0 : 8
    const crc = crc32(data)

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuf.copy(local, 30)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(day, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)

    locals.push(local, body)
    centrals.push(central)
    offset += local.length + body.length
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, ...centrals, end])
}

/* ---------- package ---------- */

const files = walk(dist)
  .filter((file) => !file.endsWith('.map'))
  .map((file) => ({ name: relative(dist, file).split('\\').join('/'), data: readFileSync(file) }))
  .sort((a, b) => a.name.localeCompare(b.name))

if (!files.some((f) => f.name === 'manifest.json')) {
  throw new Error('dist/manifest.json missing — the build did not produce an extension')
}

const manifest = JSON.parse(files.find((f) => f.name === 'manifest.json').data.toString('utf8'))
if (manifest.version !== pkg.version) {
  throw new Error(`manifest version ${manifest.version} != package.json ${pkg.version}`)
}

const outDir = join(root, 'release')
mkdirSync(outDir, { recursive: true })
const out = join(outDir, `fobo-terminal-${pkg.version}.zip`)
const archive = zip(files)
writeFileSync(out, archive)

const sha = createHash('sha256').update(archive).digest('hex')
const bytes = files.reduce((n, f) => n + f.data.length, 0)
console.log(`\n${relative(root, out)}  ${(archive.length / 1024).toFixed(0)} KB zipped (${(bytes / 1024).toFixed(0)} KB raw), ${files.length} files`)
console.log(`sha256 ${sha}`)
for (const f of files) console.log(`  ${f.name}`)
