/**
 * Themes Tests
 *
 * Tests for the color theme system.
 */

import { describe, it, expect } from 'vitest';

// Theme definitions
type ThemeName = 'default' | 'ocean' | 'forest' | 'sunset' | 'mono' | 'hacker';

interface Theme {
  name: ThemeName;
  displayName: string;
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  muted: string;
}

const themes: Record<ThemeName, Theme> = {
  default: {
    name: 'default',
    displayName: 'Default',
    primary: 'cyan',
    secondary: 'white',
    success: 'green',
    warning: 'yellow',
    error: 'red',
    muted: 'gray',
  },
  ocean: {
    name: 'ocean',
    displayName: 'Ocean',
    primary: 'blue',
    secondary: 'cyanBright',
    success: 'greenBright',
    warning: 'yellow',
    error: 'redBright',
    muted: 'blueBright',
  },
  forest: {
    name: 'forest',
    displayName: 'Forest',
    primary: 'green',
    secondary: 'greenBright',
    success: 'green',
    warning: 'yellowBright',
    error: 'red',
    muted: 'gray',
  },
  sunset: {
    name: 'sunset',
    displayName: 'Sunset',
    primary: 'yellow',
    secondary: 'yellowBright',
    success: 'green',
    warning: 'magenta',
    error: 'red',
    muted: 'gray',
  },
  mono: {
    name: 'mono',
    displayName: 'Monochrome',
    primary: 'white',
    secondary: 'gray',
    success: 'whiteBright',
    warning: 'gray',
    error: 'white',
    muted: 'gray',
  },
  hacker: {
    name: 'hacker',
    displayName: 'Hacker',
    primary: 'greenBright',
    secondary: 'green',
    success: 'greenBright',
    warning: 'yellowBright',
    error: 'redBright',
    muted: 'green',
  },
};

// Theme management functions
let currentTheme: ThemeName = 'default';

function setTheme(name: ThemeName): boolean {
  if (name in themes) {
    currentTheme = name;
    return true;
  }
  return false;
}

function getCurrentTheme(): Theme {
  return themes[currentTheme];
}

function getThemeName(): ThemeName {
  return currentTheme;
}

function getAvailableThemes(): ThemeName[] {
  return Object.keys(themes) as ThemeName[];
}

function isValidTheme(name: string): name is ThemeName {
  return name in themes;
}

function resetTheme(): void {
  currentTheme = 'default';
}

describe('Theme System', () => {
  beforeEach(() => {
    resetTheme();
  });

  describe('Theme Definitions', () => {
    it('should have all required themes', () => {
      const requiredThemes: ThemeName[] = ['default', 'ocean', 'forest', 'sunset', 'mono', 'hacker'];
      for (const theme of requiredThemes) {
        expect(themes[theme]).toBeDefined();
      }
    });

    it('should have all required color properties', () => {
      const requiredProps = ['primary', 'secondary', 'success', 'warning', 'error', 'muted'];
      for (const theme of Object.values(themes)) {
        for (const prop of requiredProps) {
          expect(theme).toHaveProperty(prop);
          expect(typeof (theme as any)[prop]).toBe('string');
        }
      }
    });

    it('should have display names for all themes', () => {
      for (const theme of Object.values(themes)) {
        expect(theme.displayName).toBeDefined();
        expect(theme.displayName.length).toBeGreaterThan(0);
      }
    });

    it('should have matching name properties', () => {
      for (const [key, theme] of Object.entries(themes)) {
        expect(theme.name).toBe(key);
      }
    });
  });

  describe('setTheme', () => {
    it('should set valid theme', () => {
      const result = setTheme('ocean');
      expect(result).toBe(true);
      expect(getThemeName()).toBe('ocean');
    });

    it('should set all available themes', () => {
      for (const themeName of getAvailableThemes()) {
        const result = setTheme(themeName);
        expect(result).toBe(true);
        expect(getThemeName()).toBe(themeName);
      }
    });

    it('should reject invalid theme', () => {
      const result = setTheme('invalid' as ThemeName);
      expect(result).toBe(false);
      expect(getThemeName()).toBe('default');
    });

    it('should preserve theme on invalid set', () => {
      setTheme('forest');
      const result = setTheme('invalid' as ThemeName);
      expect(result).toBe(false);
      expect(getThemeName()).toBe('forest');
    });
  });

  describe('getCurrentTheme', () => {
    it('should return default theme initially', () => {
      const theme = getCurrentTheme();
      expect(theme.name).toBe('default');
    });

    it('should return correct theme after change', () => {
      setTheme('hacker');
      const theme = getCurrentTheme();
      expect(theme.name).toBe('hacker');
      expect(theme.primary).toBe('greenBright');
    });

    it('should return complete theme object', () => {
      const theme = getCurrentTheme();
      expect(theme).toHaveProperty('name');
      expect(theme).toHaveProperty('displayName');
      expect(theme).toHaveProperty('primary');
      expect(theme).toHaveProperty('secondary');
      expect(theme).toHaveProperty('success');
      expect(theme).toHaveProperty('warning');
      expect(theme).toHaveProperty('error');
      expect(theme).toHaveProperty('muted');
    });
  });

  describe('getAvailableThemes', () => {
    it('should return array of theme names', () => {
      const available = getAvailableThemes();
      expect(Array.isArray(available)).toBe(true);
      expect(available.length).toBe(6);
    });

    it('should include all themes', () => {
      const available = getAvailableThemes();
      expect(available).toContain('default');
      expect(available).toContain('ocean');
      expect(available).toContain('forest');
      expect(available).toContain('sunset');
      expect(available).toContain('mono');
      expect(available).toContain('hacker');
    });
  });

  describe('isValidTheme', () => {
    it('should return true for valid themes', () => {
      expect(isValidTheme('default')).toBe(true);
      expect(isValidTheme('ocean')).toBe(true);
      expect(isValidTheme('forest')).toBe(true);
      expect(isValidTheme('sunset')).toBe(true);
      expect(isValidTheme('mono')).toBe(true);
      expect(isValidTheme('hacker')).toBe(true);
    });

    it('should return false for invalid themes', () => {
      expect(isValidTheme('invalid')).toBe(false);
      expect(isValidTheme('')).toBe(false);
      expect(isValidTheme('DEFAULT')).toBe(false);
      expect(isValidTheme('Ocean')).toBe(false);
    });
  });

  describe('resetTheme', () => {
    it('should reset to default theme', () => {
      setTheme('hacker');
      expect(getThemeName()).toBe('hacker');
      resetTheme();
      expect(getThemeName()).toBe('default');
    });
  });

  describe('Theme Color Uniqueness', () => {
    it('should have different primary colors for most themes', () => {
      const primaryColors = Object.values(themes).map(t => t.primary);
      const uniqueColors = new Set(primaryColors);
      // At least 4 different primary colors
      expect(uniqueColors.size).toBeGreaterThanOrEqual(4);
    });

    it('hacker theme should use green variants', () => {
      const hacker = themes.hacker;
      expect(hacker.primary).toContain('green');
      expect(hacker.secondary).toContain('green');
    });

    it('mono theme should use grayscale', () => {
      const mono = themes.mono;
      expect(['white', 'gray', 'whiteBright']).toContain(mono.primary);
      expect(['white', 'gray', 'whiteBright']).toContain(mono.secondary);
    });
  });
});

describe('Auto-lock Timer', () => {
  let autoLockTimeout = 300000; // 5 minutes default
  let lastActivity = Date.now();
  let isLocked = false;

  function setAutoLockTimeout(minutes: number): void {
    if (minutes < 0) throw new Error('Timeout cannot be negative');
    autoLockTimeout = minutes * 60 * 1000;
  }

  function getAutoLockTimeout(): number {
    return autoLockTimeout / 60000;
  }

  function resetActivity(): void {
    lastActivity = Date.now();
  }

  function checkAutoLock(): boolean {
    if (autoLockTimeout === 0) return false;
    return Date.now() - lastActivity >= autoLockTimeout;
  }

  function lock(): void {
    isLocked = true;
  }

  function unlock(): void {
    isLocked = false;
    resetActivity();
  }

  beforeEach(() => {
    autoLockTimeout = 300000;
    lastActivity = Date.now();
    isLocked = false;
  });

  describe('setAutoLockTimeout', () => {
    it('should set timeout in minutes', () => {
      setAutoLockTimeout(10);
      expect(getAutoLockTimeout()).toBe(10);
    });

    it('should handle zero (disabled)', () => {
      setAutoLockTimeout(0);
      expect(getAutoLockTimeout()).toBe(0);
    });

    it('should reject negative values', () => {
      expect(() => setAutoLockTimeout(-1)).toThrow();
    });

    it('should handle large values', () => {
      setAutoLockTimeout(1440); // 24 hours
      expect(getAutoLockTimeout()).toBe(1440);
    });
  });

  describe('checkAutoLock', () => {
    it('should return false when recently active', () => {
      resetActivity();
      expect(checkAutoLock()).toBe(false);
    });

    it('should return false when disabled', () => {
      setAutoLockTimeout(0);
      lastActivity = 0; // Long time ago
      expect(checkAutoLock()).toBe(false);
    });

    it('should return true when timeout exceeded', () => {
      setAutoLockTimeout(1); // 1 minute
      lastActivity = Date.now() - 120000; // 2 minutes ago
      expect(checkAutoLock()).toBe(true);
    });
  });

  describe('activity tracking', () => {
    it('should reset activity time', () => {
      lastActivity = 0;
      resetActivity();
      expect(Date.now() - lastActivity).toBeLessThan(100);
    });

    it('should reset on unlock', () => {
      lastActivity = 0;
      unlock();
      expect(Date.now() - lastActivity).toBeLessThan(100);
    });
  });
});

describe('Command History', () => {
  const MAX_HISTORY = 1000;
  let history: string[] = [];

  function addToHistory(command: string): void {
    if (!command.trim()) return;

    // Don't store sensitive commands
    const sensitivePatterns = [/password/i, /secret/i, /--pass/i];
    for (const pattern of sensitivePatterns) {
      if (pattern.test(command)) return;
    }

    // Remove duplicate if exists
    const existingIndex = history.indexOf(command);
    if (existingIndex !== -1) {
      history.splice(existingIndex, 1);
    }

    history.push(command);

    // Trim to max size
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }
  }

  function getHistory(count?: number): string[] {
    if (count) {
      return history.slice(-count);
    }
    return [...history];
  }

  function clearHistory(): void {
    history = [];
  }

  function searchHistory(query: string): string[] {
    return history.filter(cmd => cmd.includes(query));
  }

  beforeEach(() => {
    clearHistory();
  });

  describe('addToHistory', () => {
    it('should add commands to history', () => {
      addToHistory('list');
      addToHistory('get google');
      expect(getHistory()).toHaveLength(2);
    });

    it('should ignore empty commands', () => {
      addToHistory('');
      addToHistory('   ');
      expect(getHistory()).toHaveLength(0);
    });

    it('should filter sensitive commands', () => {
      addToHistory('add --password secret123');
      addToHistory('set password');
      addToHistory('show secret');
      expect(getHistory()).toHaveLength(0);
    });

    it('should move duplicates to end', () => {
      addToHistory('list');
      addToHistory('get');
      addToHistory('list');
      const hist = getHistory();
      expect(hist).toHaveLength(2);
      expect(hist[hist.length - 1]).toBe('list');
    });

    it('should respect max history limit', () => {
      for (let i = 0; i < 1100; i++) {
        addToHistory(`command${i}`);
      }
      expect(getHistory()).toHaveLength(MAX_HISTORY);
    });
  });

  describe('getHistory', () => {
    it('should return all history', () => {
      addToHistory('cmd1');
      addToHistory('cmd2');
      addToHistory('cmd3');
      expect(getHistory()).toEqual(['cmd1', 'cmd2', 'cmd3']);
    });

    it('should return limited history', () => {
      addToHistory('cmd1');
      addToHistory('cmd2');
      addToHistory('cmd3');
      expect(getHistory(2)).toEqual(['cmd2', 'cmd3']);
    });

    it('should return copy of history', () => {
      addToHistory('cmd1');
      const hist = getHistory();
      hist.push('modified');
      expect(getHistory()).toHaveLength(1);
    });
  });

  describe('searchHistory', () => {
    it('should find matching commands', () => {
      addToHistory('list entries');
      addToHistory('get google');
      addToHistory('list favorites');
      const results = searchHistory('list');
      expect(results).toHaveLength(2);
    });

    it('should return empty for no matches', () => {
      addToHistory('list');
      addToHistory('get');
      expect(searchHistory('xyz')).toHaveLength(0);
    });
  });
});
