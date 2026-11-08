import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export function isMain(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    // macOS /var and /private/var (and symlinked project folders) name the same file.
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(process.argv[1]);
  } catch { return false; }
}
