import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const dataDirectory = join(process.cwd(), 'data')
mkdirSync(dataDirectory, { recursive: true })

export const database = new DatabaseSync(join(dataDirectory, 'domainmate.sqlite'))
