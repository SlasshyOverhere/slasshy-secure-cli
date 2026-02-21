import zxcvbn from 'zxcvbn';
import chalk from 'chalk';

/**
 * Password strength result
 */
export interface PasswordStrengthResult {
  score: number;  // 0-4
  scoreLabel: string;
  crackTimeDisplay: string;
  crackTimeSeconds: number;
  feedback: {
    warning: string;
    suggestions: string[];
  };
  guesses: number;
  guessesLog10: number;
}

/**
 * Analyze password strength using zxcvbn
 */
export function analyzePasswordStrength(password: string, userInputs?: string[]): PasswordStrengthResult {
  // Add common user inputs that should weaken the password if found
  const inputs = userInputs || [];

  const result = zxcvbn(password, inputs);

  const scoreLabels = [
    'Very Weak',
    'Weak',
    'Fair',
    'Strong',
    'Very Strong',
  ];

  return {
    score: result.score,
    scoreLabel: scoreLabels[result.score] || 'Unknown',
    crackTimeDisplay: result.crack_times_display.offline_slow_hashing_1e4_per_second as string,
    crackTimeSeconds: result.crack_times_seconds.offline_slow_hashing_1e4_per_second as number,
    feedback: {
      warning: result.feedback.warning || '',
      suggestions: result.feedback.suggestions || [],
    },
    guesses: result.guesses,
    guessesLog10: result.guesses_log10,
  };
}

/**
 * Get color for score
 */
export function getScoreColor(score: number): (text: string) => string {
  switch (score) {
    case 0: return chalk.red;
    case 1: return chalk.red;
    case 2: return chalk.yellow;
    case 3: return chalk.cyan;
    case 4: return chalk.green;
    default: return chalk.gray;
  }
}

/**
 * Get score bar visualization
 */
export function getScoreBar(score: number): string {
  const bars = ['░', '░', '░', '░'];
  const color = getScoreColor(score);

  for (let i = 0; i <= score; i++) {
    bars[i] = '█';
  }

  return color(bars.join(''));
}

/**
 * Display password strength analysis
 */
export function displayPasswordStrength(password: string, options?: {
  title?: string;
  userInputs?: string[];
  showSuggestions?: boolean;
}): PasswordStrengthResult {
  const result = analyzePasswordStrength(password, options?.userInputs);
  const color = getScoreColor(result.score);

  console.log('');
  if (options?.title) {
    console.log(chalk.bold(`  ${options.title}`));
  }
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  // Score visualization
  console.log(`  ${chalk.gray('Strength:')}   ${getScoreBar(result.score)} ${color(result.scoreLabel)}`);

  // Crack time
  console.log(`  ${chalk.gray('Crack time:')} ${chalk.white(result.crackTimeDisplay)}`);

  // Entropy approximation
  const entropyBits = Math.round(result.guessesLog10 * 3.32);
  console.log(`  ${chalk.gray('Entropy:')}    ~${entropyBits} bits`);

  // Warning
  if (result.feedback.warning) {
    console.log(`  ${chalk.yellow('⚠ Warning:')} ${result.feedback.warning}`);
  }

  // Suggestions
  if (options?.showSuggestions && result.feedback.suggestions.length > 0) {
    console.log(`  ${chalk.gray('Suggestions:')}`);
    result.feedback.suggestions.forEach(suggestion => {
      console.log(`    ${chalk.gray('•')} ${suggestion}`);
    });
  }

  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log('');

  return result;
}

/**
 * Check if password meets minimum security requirements
 */
export function meetsSecurityRequirements(password: string): {
  meets: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const result = analyzePasswordStrength(password);

  // Minimum score requirement
  if (result.score < 2) {
    issues.push('Password is too weak (minimum: Fair)');
  }

  // Minimum length
  if (password.length < 8) {
    issues.push('Password must be at least 8 characters');
  }

  // Minimum crack time (at least 1 hour)
  if (result.crackTimeSeconds < 3600) {
    issues.push('Password can be cracked too quickly');
  }

  return {
    meets: issues.length === 0,
    issues,
  };
}

/**
 * Get password strength summary for list display
 */
export function getStrengthSummary(password: string): {
  score: number;
  icon: string;
  label: string;
} {
  const result = analyzePasswordStrength(password);

  const icons = ['🔴', '🟠', '🟡', '🟢', '💚'];
  const labels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];

  return {
    score: result.score,
    icon: icons[result.score] || '⚪',
    label: labels[result.score] || 'Unknown',
  };
}
