import crypto from 'crypto';

/**
 * Password Generator Configuration
 */
export interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean; // Exclude 0, O, l, 1, I, etc.
  excludeChars?: string; // Custom characters to exclude
  customSymbols?: string; // Custom symbol set
}

/**
 * Default password generation options
 */
export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: true,
};

/**
 * Character sets for password generation
 */
const CHAR_SETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  uppercaseUnambiguous: 'ABCDEFGHJKLMNPQRSTUVWXYZ', // Excludes I, O
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  lowercaseUnambiguous: 'abcdefghjkmnpqrstuvwxyz', // Excludes i, l, o
  numbers: '0123456789',
  numbersUnambiguous: '23456789', // Excludes 0, 1
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
  symbolsSafe: '!@#$%^&*_+-=', // Safer subset for compatibility
};

/**
 * Password strength levels
 */
export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong' | 'excellent';

/**
 * Password strength result
 */
export interface StrengthResult {
  strength: PasswordStrength;
  score: number; // 0-100
  entropy: number; // bits of entropy
  feedback: string[];
}

/**
 * Generate a cryptographically secure random password
 *
 * Uses crypto.randomBytes for true randomness, not Math.random()
 */
export function generatePassword(options: Partial<PasswordOptions> = {}): string {
  const opts: PasswordOptions = { ...DEFAULT_PASSWORD_OPTIONS, ...options };

  // Build character pool
  let charPool = '';

  if (opts.uppercase) {
    charPool += opts.excludeAmbiguous ? CHAR_SETS.uppercaseUnambiguous : CHAR_SETS.uppercase;
  }

  if (opts.lowercase) {
    charPool += opts.excludeAmbiguous ? CHAR_SETS.lowercaseUnambiguous : CHAR_SETS.lowercase;
  }

  if (opts.numbers) {
    charPool += opts.excludeAmbiguous ? CHAR_SETS.numbersUnambiguous : CHAR_SETS.numbers;
  }

  if (opts.symbols) {
    charPool += opts.customSymbols || CHAR_SETS.symbols;
  }

  // Remove excluded characters
  if (opts.excludeChars) {
    for (const char of opts.excludeChars) {
      charPool = charPool.replace(new RegExp(escapeRegExp(char), 'g'), '');
    }
  }

  // Validate we have characters to use
  if (charPool.length === 0) {
    throw new Error('Password options result in empty character pool');
  }

  if (opts.length < 4) {
    throw new Error('Password length must be at least 4 characters');
  }

  if (opts.length > 256) {
    throw new Error('Password length must not exceed 256 characters');
  }

  // Generate password using crypto.randomBytes
  const password = secureRandomString(charPool, opts.length);

  // Ensure password meets requirements (has at least one from each enabled category)
  if (!meetsRequirements(password, opts)) {
    // Regenerate with guaranteed characters from each category
    return generateWithGuarantees(opts, charPool);
  }

  return password;
}

/**
 * Generate a password with guaranteed character types
 */
function generateWithGuarantees(opts: PasswordOptions, charPool: string): string {
  const guaranteedChars: string[] = [];

  // Add one guaranteed character from each enabled category
  if (opts.uppercase) {
    const set = opts.excludeAmbiguous ? CHAR_SETS.uppercaseUnambiguous : CHAR_SETS.uppercase;
    guaranteedChars.push(secureRandomChar(set));
  }

  if (opts.lowercase) {
    const set = opts.excludeAmbiguous ? CHAR_SETS.lowercaseUnambiguous : CHAR_SETS.lowercase;
    guaranteedChars.push(secureRandomChar(set));
  }

  if (opts.numbers) {
    const set = opts.excludeAmbiguous ? CHAR_SETS.numbersUnambiguous : CHAR_SETS.numbers;
    guaranteedChars.push(secureRandomChar(set));
  }

  if (opts.symbols) {
    const set = opts.customSymbols || CHAR_SETS.symbols;
    guaranteedChars.push(secureRandomChar(set));
  }

  // Fill remaining length with random chars from full pool
  const remainingLength = opts.length - guaranteedChars.length;
  const remainingChars = secureRandomString(charPool, remainingLength);

  // Combine and shuffle securely
  const allChars = [...guaranteedChars, ...remainingChars.split('')];
  return secureShuffleArray(allChars).join('');
}

/**
 * Generate a cryptographically secure random string
 */
function secureRandomString(charPool: string, length: number): string {
  const poolLength = charPool.length;
  const result: string[] = [];

  // Use rejection sampling to avoid modulo bias
  const maxValid = Math.floor(256 / poolLength) * poolLength;

  let randomPool = Buffer.alloc(0);
  let poolIndex = 0;

  while (result.length < length) {
    if (poolIndex >= randomPool.length) {
      const remaining = length - result.length;
      // Batch entropy reads to avoid expensive per-byte crypto calls.
      randomPool = crypto.randomBytes(Math.max(32, remaining * 4));
      poolIndex = 0;
    }

    const randomByte = randomPool[poolIndex++]!;
    if (randomByte < maxValid) {
      result.push(charPool[randomByte % poolLength]!);
    }
  }

  return result.join('');
}

/**
 * Get a single secure random character from a string
 */
function secureRandomChar(charSet: string): string {
  return secureRandomString(charSet, 1);
}

/**
 * Securely shuffle an array using Fisher-Yates with crypto.randomBytes
 */
function secureShuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];

  for (let i = shuffled.length - 1; i > 0; i--) {
    // Generate a random index from 0 to i (inclusive)
    const randomBytes = crypto.randomBytes(4);
    const randomValue = randomBytes.readUInt32BE(0);
    const j = randomValue % (i + 1);

    // Swap elements
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  return shuffled;
}

/**
 * Check if password meets the requirements
 */
function meetsRequirements(password: string, opts: PasswordOptions): boolean {
  if (opts.uppercase && !/[A-Z]/.test(password)) return false;
  if (opts.lowercase && !/[a-z]/.test(password)) return false;
  if (opts.numbers && !/[0-9]/.test(password)) return false;
  if (opts.symbols) {
    const symbolSet = opts.customSymbols || CHAR_SETS.symbols;
    const hasSymbol = password.split('').some(c => symbolSet.includes(c));
    if (!hasSymbol) return false;
  }
  return true;
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Calculate password entropy (bits)
 */
export function calculateEntropy(password: string): number {
  const charsetSize = getCharsetSize(password);
  return password.length * Math.log2(charsetSize);
}

/**
 * Get the effective charset size based on password characters
 */
function getCharsetSize(password: string): number {
  let size = 0;

  if (/[a-z]/.test(password)) size += 26;
  if (/[A-Z]/.test(password)) size += 26;
  if (/[0-9]/.test(password)) size += 10;
  if (/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) size += 28;
  if (/[^a-zA-Z0-9!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) size += 32; // Other chars

  return Math.max(size, 1);
}

/**
 * Analyze password strength
 */
export function analyzePassword(password: string): StrengthResult {
  const feedback: string[] = [];
  let score = 0;

  // Length scoring
  const length = password.length;
  if (length >= 20) {
    score += 25;
  } else if (length >= 16) {
    score += 20;
  } else if (length >= 12) {
    score += 15;
  } else if (length >= 8) {
    score += 10;
  } else {
    score += 5;
    feedback.push('Password is too short (min 8 characters)');
  }

  // Character variety scoring
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);

  let variety = 0;
  if (hasLower) variety++;
  if (hasUpper) variety++;
  if (hasNumber) variety++;
  if (hasSymbol) variety++;

  score += variety * 10;

  if (!hasUpper) feedback.push('Add uppercase letters');
  if (!hasLower) feedback.push('Add lowercase letters');
  if (!hasNumber) feedback.push('Add numbers');
  if (!hasSymbol) feedback.push('Add symbols for extra security');

  // Entropy scoring
  const entropy = calculateEntropy(password);
  if (entropy >= 100) {
    score += 25;
  } else if (entropy >= 80) {
    score += 20;
  } else if (entropy >= 60) {
    score += 15;
  } else if (entropy >= 40) {
    score += 10;
  } else {
    score += 5;
  }

  // Check for common patterns (penalty)
  if (/^[a-z]+$/.test(password) || /^[A-Z]+$/.test(password)) {
    score -= 10;
    feedback.push('Avoid using only letters');
  }

  if (/^[0-9]+$/.test(password)) {
    score -= 15;
    feedback.push('Avoid using only numbers');
  }

  if (/(.)\1{2,}/.test(password)) {
    score -= 10;
    feedback.push('Avoid repeated characters');
  }

  if (/^(123|abc|qwe|password|admin)/i.test(password)) {
    score -= 20;
    feedback.push('Avoid common patterns');
  }

  // Normalize score
  score = Math.max(0, Math.min(100, score));

  // Determine strength level
  let strength: PasswordStrength;
  if (score >= 80) {
    strength = 'excellent';
  } else if (score >= 65) {
    strength = 'strong';
  } else if (score >= 50) {
    strength = 'good';
  } else if (score >= 35) {
    strength = 'fair';
  } else {
    strength = 'weak';
  }

  return {
    strength,
    score,
    entropy: Math.round(entropy * 10) / 10,
    feedback,
  };
}

/**
 * Generate a memorable passphrase (word-based)
 */
export function generatePassphrase(wordCount: number = 5, separator: string = '-'): string {
  // EFF's short wordlist - cryptographically secure word selection
  const words = [
    'apple', 'beach', 'cloud', 'dance', 'eagle', 'flame', 'grape', 'happy',
    'ivory', 'jolly', 'kayak', 'lemon', 'mango', 'novel', 'ocean', 'piano',
    'quiet', 'river', 'sunny', 'tiger', 'ultra', 'vivid', 'water', 'xerox',
    'youth', 'zebra', 'amber', 'brave', 'crisp', 'drift', 'ember', 'frost',
    'gleam', 'haven', 'ideal', 'jewel', 'knack', 'lunar', 'maple', 'noble',
    'orbit', 'prism', 'quest', 'ridge', 'storm', 'torch', 'unity', 'valor',
    'winds', 'xenon', 'yeast', 'zesty', 'acorn', 'blaze', 'cedar', 'delta',
    'epoch', 'flora', 'grand', 'haste', 'input', 'joker', 'karma', 'lotus',
  ];

  if (wordCount < 3) {
    throw new Error('Passphrase must have at least 3 words');
  }

  if (wordCount > 12) {
    throw new Error('Passphrase must not exceed 12 words');
  }

  const selectedWords: string[] = [];

  for (let i = 0; i < wordCount; i++) {
    const randomIndex = crypto.randomInt(0, words.length);
    selectedWords.push(words[randomIndex]!);
  }

  // Capitalize first letter of each word and add a number at the end for variety
  const passphrase = selectedWords
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(separator);

  // Add a random number for extra entropy
  const randomNum = crypto.randomInt(10, 100);

  return `${passphrase}${separator}${randomNum}`;
}

/**
 * Preset configurations for common use cases
 */
export const PASSWORD_PRESETS = {
  standard: {
    length: 16,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    excludeAmbiguous: true,
  },
  strong: {
    length: 24,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    excludeAmbiguous: false,
  },
  pin: {
    length: 6,
    uppercase: false,
    lowercase: false,
    numbers: true,
    symbols: false,
    excludeAmbiguous: false,
  },
  alphanumeric: {
    length: 16,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: false,
    excludeAmbiguous: true,
  },
  memorable: {
    length: 12,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: false,
    excludeAmbiguous: true,
  },
} as const;
