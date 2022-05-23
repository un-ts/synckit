import fs from 'node:fs'

import { runAsWorker } from '../lib/index.js'

runAsWorker(filename => fs.promises.readFile(filename, 'utf8'))
