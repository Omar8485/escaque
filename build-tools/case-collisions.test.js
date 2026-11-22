import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// En Windows y macOS el sistema de archivos no distingue mayúsculas: `import './Achievements'`
// puede resolver a `achievements.js` en lugar de `Achievements.jsx` y romper el build solo allí.
// Por eso dos módulos de la misma carpeta no pueden llamarse igual salvo por mayúsculas.
const MODULE = /\.(m?jsx?|tsx?)$/

function collisions(dir) {
  const found = []
  const seen = new Map()
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { found.push(...collisions(path)); continue }
    if (!MODULE.test(entry.name)) continue
    const key = entry.name.replace(/(\.test)?\.[^.]+$/, '$1').toLowerCase()
    const base = entry.name.replace(/(\.test)?\.[^.]+$/, '$1')
    const other = seen.get(key)
    if (other && other !== base) found.push(`${join(dir, other)} ↔ ${path}`)
    else seen.set(key, base)
  }
  return found
}

describe('nombres de módulos', () => {
  it('no hay dos módulos que solo difieran en mayúsculas (rompe el build en Windows)', () => {
    expect([...collisions('src'), ...collisions('worker'), ...collisions('shared')]).toEqual([])
  })
})
