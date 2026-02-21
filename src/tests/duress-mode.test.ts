/**
 * Duress Mode Test Suite
 *
 * Manual test cases for verifying duress mode works correctly across all commands.
 * Run these tests by entering the duress password at startup, then executing each command.
 *
 * Prerequisites:
 * 1. Have a vault initialized with real entries
 * 2. Have duress password configured (run `duress` command while unlocked with real password)
 * 3. Exit and restart CLI, enter duress password instead of master password
 */

/**
 * TEST CASES FOR DURESS MODE
 *
 * Execute these commands after unlocking with duress password.
 * Each should show decoy/fake data and NOT prompt for password again.
 */

export const duressTestCases = {
  /**
   * TEST 1: list
   * Expected: Shows 2 decoy entries (Email, Bank)
   * Should NOT: Ask for password again
   */
  list: {
    command: 'list',
    expected: [
      'Shows "Passwords (2)"',
      'Shows "Email" entry',
      'Shows "Bank" entry',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 2: get
   * Expected: Shows decoy entry selection, fake password
   */
  get: {
    command: 'get',
    expected: [
      'Shows entry selection (Email, Bank)',
      'Shows fake password when selected',
      'Copy to clipboard works (copies fake password)',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 3: get email
   * Expected: Shows Email decoy entry with fake password
   */
  getWithSearch: {
    command: 'get email',
    expected: [
      'Finds "Email" entry',
      'Shows username: user@example.com',
      'Shows fake password',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 4: add
   * Expected: Prompts for entry details, pretends to save
   */
  add: {
    command: 'add',
    expected: [
      'Prompts for title, username, password, etc.',
      'Shows "Entry saved successfully"',
      'Does NOT actually save anything',
      'Does NOT ask for Master Password at start',
    ],
  },

  /**
   * TEST 5: edit
   * Expected: Shows decoy entries, pretends to edit
   */
  edit: {
    command: 'edit',
    expected: [
      'Shows decoy entries to select',
      'Allows selecting fields to edit',
      'Shows "Entry updated" message',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 6: delete
   * Expected: Shows decoy entries, pretends to delete
   */
  delete: {
    command: 'delete',
    expected: [
      'Shows decoy entries to select',
      'Asks for confirmation',
      'Shows "Entry deleted" message',
      'Does NOT actually delete anything',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 7: favorite
   * Expected: Shows decoy entries, pretends to toggle favorite
   */
  favorite: {
    command: 'fav',
    expected: [
      'Shows decoy entries to select',
      'Shows "Added to favorites" or "Removed from favorites"',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 8: favorites
   * Expected: Shows one decoy entry as favorite
   */
  favorites: {
    command: 'favs',
    expected: [
      'Shows at least one favorite entry',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 9: status
   * Expected: Shows fake vault status
   */
  status: {
    command: 'status',
    expected: [
      'Shows "Vault Status"',
      'Shows entry count matching decoy entries',
      'Shows fake sync status',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 10: note
   * Expected: Shows no notes
   */
  noteList: {
    command: 'note list',
    expected: [
      'Shows "No notes found"',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 11: note add
   * Expected: Prompts for note, pretends to save
   */
  noteAdd: {
    command: 'note add',
    expected: [
      'Prompts for title and content',
      'Shows "Note saved" message',
      'Does NOT actually save',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 12: totp
   * Expected: Shows no TOTP entries
   */
  totpList: {
    command: 'totp list',
    expected: [
      'Shows "No entries have TOTP configured"',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 13: audit
   * Expected: Shows fake audit results (all good)
   */
  audit: {
    command: 'audit',
    expected: [
      'Shows "Security Audit"',
      'Shows all entries as healthy/strong',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 14: upload
   * Expected: Accepts file, pretends to upload
   */
  upload: {
    command: 'upload test.txt',
    expected: [
      'Validates file exists',
      'Shows encryption progress',
      'Shows upload progress',
      'Shows "File uploaded successfully"',
      'Does NOT actually upload',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 15: download
   * Expected: Shows no files
   */
  download: {
    command: 'download',
    expected: [
      'Shows "No files found in vault"',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 16: breach
   * Expected: Shows fake breach check results
   */
  breach: {
    command: 'breach',
    expected: [
      'Shows breach check results',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 17: help
   * Expected: Shows normal help (no sensitive data)
   */
  help: {
    command: 'help',
    expected: [
      'Shows all available commands',
      'Does NOT reveal duress mode',
    ],
  },

  /**
   * TEST 18: lock
   * Expected: Locks the vault (exits duress mode)
   */
  lock: {
    command: 'lock',
    expected: [
      'Shows "Vault locked"',
      'Clears duress mode state',
    ],
  },

  /**
   * TEST 19: 2fa-setup (should be blocked in duress mode)
   * Expected: Shows error or pretends
   */
  twoFaSetup: {
    command: '2fa-setup',
    expected: [
      'Either shows error OR pretends to set up',
      'Does NOT modify real 2FA settings',
      'Does NOT ask for Master Password',
    ],
  },

  /**
   * TEST 20: duress (should be blocked in duress mode)
   * Expected: Shows error - can't configure duress while in duress mode
   */
  duressConfig: {
    command: 'duress',
    expected: [
      'Shows "Cannot configure duress settings in duress mode"',
      'Does NOT allow reconfiguration',
    ],
  },
};

/**
 * Test execution script (run manually)
 */
export function printTestInstructions(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    DURESS MODE TEST SUITE                        ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  SETUP:                                                          ║
║  1. Start CLI with: npm start                                    ║
║  2. Unlock with REAL master password                             ║
║  3. Run: duress                                                  ║
║  4. Set duress password (e.g., "12345")                          ║
║  5. Run: exit                                                    ║
║  6. Start CLI again: npm start                                   ║
║  7. Enter DURESS password (e.g., "12345")                        ║
║                                                                  ║
║  TESTS TO RUN:                                                   ║
║  After unlocking with duress password, run each command below.   ║
║  Each should work WITHOUT asking for password again.             ║
║                                                                  ║
║  □ list          - Should show Email, Bank entries               ║
║  □ get           - Should show fake password                     ║
║  □ get email     - Should find Email entry                       ║
║  □ add           - Should pretend to add                         ║
║  □ edit          - Should pretend to edit                        ║
║  □ delete        - Should pretend to delete                      ║
║  □ fav           - Should pretend to favorite                    ║
║  □ favs          - Should show favorites                         ║
║  □ status        - Should show fake status                       ║
║  □ note list     - Should show "No notes"                        ║
║  □ note add      - Should pretend to add note                    ║
║  □ totp list     - Should show "No TOTP"                         ║
║  □ audit         - Should show "All good"                        ║
║  □ download      - Should show "No files"                        ║
║  □ help          - Should show normal help                       ║
║  □ duress        - Should be BLOCKED                             ║
║                                                                  ║
║  SUCCESS CRITERIA:                                               ║
║  ✓ NO command asks for Master Password again                     ║
║  ✓ All commands show believable decoy/fake data                  ║
║  ✓ No real vault data is exposed                                 ║
║  ✓ Attacker cannot tell they're in duress mode                   ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
`);
}

// Export for use in automated testing
export default duressTestCases;
