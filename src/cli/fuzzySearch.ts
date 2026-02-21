import Fuse, { IFuseOptions } from 'fuse.js';
import chalk from 'chalk';

/**
 * Entry for fuzzy search
 */
export interface SearchableEntry {
  id: string;
  title: string;
  username?: string;
  url?: string;
  category?: string;
  entryType: string;
  modified: number;
  favorite: boolean;
}

/**
 * Fuzzy search result
 */
export interface FuzzySearchResult {
  item: SearchableEntry;
  score: number;
  matches?: Array<{
    key: string;
    value: string;
    indices: Array<[number, number]>;
  }>;
}

/**
 * Default fuse.js options for entry search
 */
const FUSE_OPTIONS: IFuseOptions<SearchableEntry> = {
  // Search in these fields
  keys: [
    { name: 'title', weight: 0.5 },
    { name: 'username', weight: 0.25 },
    { name: 'url', weight: 0.15 },
    { name: 'category', weight: 0.1 },
  ],
  // Enable extended search patterns
  useExtendedSearch: true,
  // Include matches for highlighting
  includeMatches: true,
  // Include score for ranking
  includeScore: true,
  // Threshold - 0 is exact match, 1 is match anything
  threshold: 0.4,
  // Minimum characters before results appear
  minMatchCharLength: 1,
  // Should search be case sensitive?
  isCaseSensitive: false,
  // Finding single words in target string
  findAllMatches: true,
  // Ignore location (search anywhere in string)
  ignoreLocation: true,
};

/**
 * Create a fuzzy search instance for entries
 */
export function createEntrySearch(entries: SearchableEntry[]): Fuse<SearchableEntry> {
  return new Fuse(entries, FUSE_OPTIONS);
}

/**
 * Perform fuzzy search on entries
 */
export function fuzzySearchEntries(
  entries: SearchableEntry[],
  query: string
): FuzzySearchResult[] {
  // If query is empty, return all entries
  if (!query.trim()) {
    return entries.map(item => ({
      item,
      score: 0,
    }));
  }

  const fuse = createEntrySearch(entries);
  const results = fuse.search(query);

  return results.map(result => ({
    item: result.item,
    score: result.score || 0,
    matches: result.matches?.map(match => ({
      key: match.key || '',
      value: match.value || '',
      indices: match.indices as Array<[number, number]>,
    })),
  }));
}

/**
 * Highlight matching parts of a string
 */
export function highlightMatches(
  text: string,
  indices: Array<[number, number]>
): string {
  if (!indices || indices.length === 0) {
    return text;
  }

  let result = '';
  let lastEnd = 0;

  // Sort indices by start position
  const sortedIndices = [...indices].sort((a, b) => a[0] - b[0]);

  for (const [start, end] of sortedIndices) {
    // Add non-matching part
    if (start > lastEnd) {
      result += text.slice(lastEnd, start);
    }
    // Add matching part with highlight
    result += chalk.yellow.bold(text.slice(start, end + 1));
    lastEnd = end + 1;
  }

  // Add remaining text
  if (lastEnd < text.length) {
    result += text.slice(lastEnd);
  }

  return result;
}

/**
 * Format search results with highlighted matches
 */
export function formatSearchResult(result: FuzzySearchResult): string {
  const { item, matches } = result;

  let titleDisplay = item.title;
  let usernameDisplay = item.username || '';

  // Highlight matches in title
  const titleMatch = matches?.find(m => m.key === 'title');
  if (titleMatch) {
    titleDisplay = highlightMatches(item.title, titleMatch.indices);
  }

  // Highlight matches in username
  const usernameMatch = matches?.find(m => m.key === 'username');
  if (usernameMatch && item.username) {
    usernameDisplay = highlightMatches(item.username, usernameMatch.indices);
  }

  // Build display line
  let line = '';

  // Entry type icon
  const icon = item.entryType === 'file' ? '📄' : item.entryType === 'note' ? '📝' : '🔐';
  line += `${icon} `;

  // Favorite star
  if (item.favorite) {
    line += '⭐ ';
  }

  // Title
  line += chalk.cyan(titleDisplay);

  // Username (if present)
  if (usernameDisplay) {
    line += chalk.gray(` (${usernameDisplay})`);
  }

  // Category (if present)
  if (item.category) {
    line += chalk.gray(` [${item.category}]`);
  }

  return line;
}

/**
 * Score threshold for "good" matches
 */
export const GOOD_MATCH_THRESHOLD = 0.3;
export const WEAK_MATCH_THRESHOLD = 0.6;

/**
 * Get match quality indicator
 */
export function getMatchQuality(score: number): string {
  if (score <= GOOD_MATCH_THRESHOLD) {
    return chalk.green('●');
  } else if (score <= WEAK_MATCH_THRESHOLD) {
    return chalk.yellow('●');
  } else {
    return chalk.red('○');
  }
}
