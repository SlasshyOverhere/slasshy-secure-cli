import { spawn } from 'child_process';
import { parseHttpUrl } from '../security/urlValidation.js';

async function spawnDetached(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Open an external HTTP(S) URL in the user's default browser.
 */
export async function openExternalUrl(rawUrl: string): Promise<void> {
  const parsed = parseHttpUrl(rawUrl);
  const url = parsed.toString();

  if (process.platform === 'win32') {
    await spawnDetached('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
    return;
  }

  if (process.platform === 'darwin') {
    await spawnDetached('open', [url]);
    return;
  }

  await spawnDetached('xdg-open', [url]);
}
