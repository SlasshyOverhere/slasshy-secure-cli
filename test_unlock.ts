import { startWebUiServer } from './src/webui/server.js';
import fetch from 'node-fetch';
import { initVault, vaultExists } from './src/storage/vault/index.js';

async function run() {
  if (!(await vaultExists())) {
    await initVault('correct_password');
  }

  const server = await startWebUiServer();
  console.log("Started", server.url);

  for (let i = 0; i < 7; i++) {
    const res = await fetch(`${server.url}/api/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-blankdrive-ui': '1' },
      body: JSON.stringify({ password: 'wrong' })
    });
    console.log(`Attempt ${i+1}: ${res.status}`, await res.json());
  }

  await server.close();
}

run().catch(console.error);
