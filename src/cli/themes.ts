import chalk, { ChalkInstance } from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Available color themes
 */
export type ThemeName = 'default' | 'ocean' | 'forest' | 'sunset' | 'mono' | 'hacker';

/**
 * Theme color definitions
 */
export interface ThemeColors {
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  muted: string;
  accent: string;
}

/**
 * Theme definitions
 */
const THEMES: Record<ThemeName, ThemeColors> = {
  default: {
    primary: '#00BFFF',    // Cyan
    secondary: '#FF69B4',  // Pink
    success: '#00FF00',    // Green
    warning: '#FFD700',    // Yellow
    error: '#FF4444',      // Red
    info: '#87CEEB',       // Light blue
    muted: '#808080',      // Gray
    accent: '#9370DB',     // Purple
  },
  ocean: {
    primary: '#0077BE',    // Ocean blue
    secondary: '#20B2AA',  // Light sea green
    success: '#3CB371',    // Medium sea green
    warning: '#F0E68C',    // Khaki
    error: '#CD5C5C',      // Indian red
    info: '#87CEFA',       // Light sky blue
    muted: '#708090',      // Slate gray
    accent: '#4682B4',     // Steel blue
  },
  forest: {
    primary: '#228B22',    // Forest green
    secondary: '#8FBC8F',  // Dark sea green
    success: '#32CD32',    // Lime green
    warning: '#DAA520',    // Goldenrod
    error: '#B22222',      // Firebrick
    info: '#90EE90',       // Light green
    muted: '#696969',      // Dim gray
    accent: '#6B8E23',     // Olive drab
  },
  sunset: {
    primary: '#FF6347',    // Tomato
    secondary: '#FF8C00',  // Dark orange
    success: '#FFD700',    // Gold
    warning: '#FFA500',    // Orange
    error: '#DC143C',      // Crimson
    info: '#FFDAB9',       // Peach puff
    muted: '#A9A9A9',      // Dark gray
    accent: '#FF69B4',     // Hot pink
  },
  mono: {
    primary: '#FFFFFF',    // White
    secondary: '#C0C0C0',  // Silver
    success: '#FFFFFF',    // White
    warning: '#C0C0C0',    // Silver
    error: '#FFFFFF',      // White (bold)
    info: '#A0A0A0',       // Light gray
    muted: '#707070',      // Gray
    accent: '#E0E0E0',     // Light gray
  },
  hacker: {
    primary: '#00FF00',    // Matrix green
    secondary: '#39FF14',  // Neon green
    success: '#00FF00',    // Green
    warning: '#ADFF2F',    // Green yellow
    error: '#FF0000',      // Red
    info: '#7FFF00',       // Chartreuse
    muted: '#006400',      // Dark green
    accent: '#32CD32',     // Lime green
  },
};

// Current theme state
let currentTheme: ThemeName = 'default';
let themeColors: ThemeColors = THEMES.default;

// Config file path
const CONFIG_DIR = path.join(os.homedir(), '.slasshy');
const THEME_CONFIG = path.join(CONFIG_DIR, 'theme.json');

/**
 * Load theme from config file
 */
export async function loadTheme(): Promise<void> {
  try {
    const data = await fs.readFile(THEME_CONFIG, 'utf-8');
    const config = JSON.parse(data);
    if (config.theme && THEMES[config.theme as ThemeName]) {
      currentTheme = config.theme;
      themeColors = THEMES[currentTheme];
    }
  } catch {
    // Use default theme if no config exists
  }
}

/**
 * Save theme to config file
 */
async function saveTheme(): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(THEME_CONFIG, JSON.stringify({ theme: currentTheme }, null, 2));
  } catch {
    // Ignore save errors
  }
}

/**
 * Set the current theme
 */
export async function setTheme(name: ThemeName): Promise<boolean> {
  if (!THEMES[name]) {
    return false;
  }
  currentTheme = name;
  themeColors = THEMES[name];
  await saveTheme();
  return true;
}

/**
 * Get the current theme name
 */
export function getCurrentTheme(): ThemeName {
  return currentTheme;
}

/**
 * Get available theme names
 */
export function getAvailableThemes(): ThemeName[] {
  return Object.keys(THEMES) as ThemeName[];
}

/**
 * Get theme colors
 */
export function getThemeColors(): ThemeColors {
  return themeColors;
}

/**
 * Theme-aware color functions
 */
export const theme = {
  primary: (text: string) => chalk.hex(themeColors.primary)(text),
  secondary: (text: string) => chalk.hex(themeColors.secondary)(text),
  success: (text: string) => chalk.hex(themeColors.success)(text),
  warning: (text: string) => chalk.hex(themeColors.warning)(text),
  error: (text: string) => chalk.hex(themeColors.error)(text),
  info: (text: string) => chalk.hex(themeColors.info)(text),
  muted: (text: string) => chalk.hex(themeColors.muted)(text),
  accent: (text: string) => chalk.hex(themeColors.accent)(text),

  // Bold variants
  primaryBold: (text: string) => chalk.hex(themeColors.primary).bold(text),
  secondaryBold: (text: string) => chalk.hex(themeColors.secondary).bold(text),
  successBold: (text: string) => chalk.hex(themeColors.success).bold(text),
  warningBold: (text: string) => chalk.hex(themeColors.warning).bold(text),
  errorBold: (text: string) => chalk.hex(themeColors.error).bold(text),
};

/**
 * Preview a theme (show sample colors)
 */
export function previewTheme(name: ThemeName): void {
  const colors = THEMES[name];
  if (!colors) return;

  console.log(`\n  Theme: ${chalk.bold(name)}`);
  console.log('  ' + '─'.repeat(40));
  console.log(`  ${chalk.hex(colors.primary)('■ Primary')}     ${chalk.hex(colors.secondary)('■ Secondary')}`);
  console.log(`  ${chalk.hex(colors.success)('■ Success')}     ${chalk.hex(colors.warning)('■ Warning')}`);
  console.log(`  ${chalk.hex(colors.error)('■ Error')}       ${chalk.hex(colors.info)('■ Info')}`);
  console.log(`  ${chalk.hex(colors.muted)('■ Muted')}       ${chalk.hex(colors.accent)('■ Accent')}`);
}

/**
 * Show all themes with previews
 */
export function showAllThemes(): void {
  console.log(chalk.bold('\n  🎨 Available Themes\n'));

  for (const name of getAvailableThemes()) {
    const isCurrent = name === currentTheme;
    const indicator = isCurrent ? chalk.green(' ✓ (current)') : '';
    const colors = THEMES[name];

    console.log(`  ${chalk.bold(name)}${indicator}`);
    console.log(`    ${chalk.hex(colors.primary)('■')} ${chalk.hex(colors.secondary)('■')} ${chalk.hex(colors.success)('■')} ${chalk.hex(colors.warning)('■')} ${chalk.hex(colors.error)('■')} ${chalk.hex(colors.info)('■')} ${chalk.hex(colors.accent)('■')}`);
  }

  console.log(chalk.gray('\n  Usage: theme <name> to change theme\n'));
}
