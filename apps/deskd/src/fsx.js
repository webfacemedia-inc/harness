// Atomic, private file writes: a crash mid-write must never leave a truncated
// auth/profile/connection file behind (a torn auth.json locks everyone out).
import { writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** Write `data` to `file` via a same-directory temp file and rename. */
export function writeAtomic(file, data, mode = 0o600) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, data, { mode })
  renameSync(tmp, file)
}
