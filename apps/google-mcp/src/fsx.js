// Atomic private writes: a token refresh mid-write must never truncate the token file.
import { writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Write `data` to `file` via a same-directory temp file and rename. */
export function writeAtomic(file, data, mode = 0o600) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, data, { mode })
  renameSync(tmp, file)
}
