#!/usr/bin/env node
import { main } from '../src/cli.js';
import { safeText } from '../src/util.js';

main().catch(error => {
  console.error(`\n  dhaara: ${safeText(error.message)}`);
  if (process.env.DHAARA_DEBUG) console.error(error.stack);
  process.exitCode = error.name === 'AbortError' ? 130 : 1;
});
