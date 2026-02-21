import chalk from 'chalk';
import inquirer from 'inquirer';

export interface GoogleOAuthInput {
  clientId: string;
  clientSecret: string;
}

function validateClientId(input: string): true | string {
  const value = input.trim();
  if (!value) {
    return 'Client ID is required.';
  }
  if (!value.endsWith('.apps.googleusercontent.com')) {
    return 'Client ID should end with ".apps.googleusercontent.com".';
  }
  return true;
}

function validateClientSecret(input: string): true | string {
  const value = input.trim();
  if (!value) {
    return 'Client Secret is required.';
  }
  if (value.length < 8) {
    return 'Client Secret looks too short.';
  }
  return true;
}

export function maskGoogleClientId(clientId: string): string {
  const value = clientId.trim();
  if (value.length <= 20) {
    return value;
  }

  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

export async function promptGoogleOAuthCredentials(): Promise<GoogleOAuthInput> {
  console.log(chalk.yellow('\n  Google OAuth Setup (Bring Your Own Credentials)'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────────────'));
  console.log(chalk.gray('  1) Create a Google OAuth "Desktop app" client.'));
  console.log(chalk.gray('  2) Paste your Client ID and Client Secret below.'));
  console.log(chalk.gray('  No backend server URL is required for Google auth.\n'));

  const answers = await inquirer.prompt<GoogleOAuthInput>([
    {
      type: 'input',
      name: 'clientId',
      message: 'Google OAuth Client ID:',
      validate: validateClientId,
      filter: (value: string) => value.trim(),
    },
    {
      type: 'password',
      mask: '*',
      name: 'clientSecret',
      message: 'Google OAuth Client Secret:',
      validate: validateClientSecret,
      filter: (value: string) => value.trim(),
    },
  ]);

  return {
    clientId: answers.clientId.trim(),
    clientSecret: answers.clientSecret.trim(),
  };
}
