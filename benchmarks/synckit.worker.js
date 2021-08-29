import fs from 'fs'

import { runAsWorker } from '../lib/index.js'

runAsWorker(filename => fs.promises.readFile(filename, 'utf8'))
