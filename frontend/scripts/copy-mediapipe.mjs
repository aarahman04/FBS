// Copies the MediaPipe WASM runtime out of node_modules and into public/ so
// the face tracker loads from our own origin instead of a CDN.
//
// Done at build time rather than committed: the files are ~35MB and are
// already pinned by the @mediapipe/tasks-vision version in package.json.
import { cp, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const to = join(root, 'public', 'mediapipe', 'wasm')

await mkdir(to, { recursive: true })
await cp(from, to, { recursive: true })

const files = await readdir(to)
console.log(`[mediapipe] copied ${files.length} runtime files to public/mediapipe/wasm`)
