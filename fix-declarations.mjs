import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await visit(path)
    else if (entry.name.endsWith('.d.ts')) {
      const source = await readFile(path, 'utf8')
      await writeFile(path, source.replace(/(['"])(\.\.?\/[^'"]+)\.tsx?\1/g, '$1$2.js$1'))
    }
  }
}

await visit('lib/types')
