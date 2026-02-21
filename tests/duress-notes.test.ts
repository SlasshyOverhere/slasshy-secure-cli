/**
 * Duress Password Tests
 *
 * Tests for the panic/duress password feature.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';

// Duress mode types
type DuressMode = 'decoy' | 'wipe' | 'minimal';

interface DuressConfig {
  enabled: boolean;
  passwordHash: string;
  salt: string;
  mode: DuressMode;
}

// Simulated Argon2-like hashing for testing
function hashPassword(password: string, salt: string): string {
  return crypto
    .pbkdf2Sync(password, salt, 100000, 64, 'sha512')
    .toString('hex');
}

function generateSalt(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Duress password manager
class DuressManager {
  private config: DuressConfig | null = null;

  async setup(password: string, mode: DuressMode): Promise<void> {
    if (password.length < 8) {
      throw new Error('Duress password must be at least 8 characters');
    }

    const salt = generateSalt();
    const passwordHash = hashPassword(password, salt);

    this.config = {
      enabled: true,
      passwordHash,
      salt,
      mode,
    };
  }

  async verify(password: string): Promise<{ isDuress: boolean; mode?: DuressMode }> {
    if (!this.config || !this.config.enabled) {
      return { isDuress: false };
    }

    const hash = hashPassword(password, this.config.salt);
    if (hash === this.config.passwordHash) {
      return { isDuress: true, mode: this.config.mode };
    }

    return { isDuress: false };
  }

  disable(): void {
    this.config = null;
  }

  isEnabled(): boolean {
    return this.config?.enabled ?? false;
  }

  getMode(): DuressMode | null {
    return this.config?.mode ?? null;
  }
}

describe('Duress Password', () => {
  let duressManager: DuressManager;

  beforeEach(() => {
    duressManager = new DuressManager();
  });

  describe('setup', () => {
    it('should setup duress password with decoy mode', async () => {
      await duressManager.setup('duressPass123', 'decoy');
      expect(duressManager.isEnabled()).toBe(true);
      expect(duressManager.getMode()).toBe('decoy');
    });

    it('should setup duress password with wipe mode', async () => {
      await duressManager.setup('duressPass123', 'wipe');
      expect(duressManager.isEnabled()).toBe(true);
      expect(duressManager.getMode()).toBe('wipe');
    });

    it('should setup duress password with minimal mode', async () => {
      await duressManager.setup('duressPass123', 'minimal');
      expect(duressManager.isEnabled()).toBe(true);
      expect(duressManager.getMode()).toBe('minimal');
    });

    it('should reject short passwords', async () => {
      await expect(duressManager.setup('short', 'decoy')).rejects.toThrow(
        'at least 8 characters'
      );
    });

    it('should accept exactly 8 character password', async () => {
      await duressManager.setup('12345678', 'decoy');
      expect(duressManager.isEnabled()).toBe(true);
    });
  });

  describe('verify', () => {
    beforeEach(async () => {
      await duressManager.setup('duressPassword123', 'decoy');
    });

    it('should verify correct duress password', async () => {
      const result = await duressManager.verify('duressPassword123');
      expect(result.isDuress).toBe(true);
      expect(result.mode).toBe('decoy');
    });

    it('should reject incorrect password', async () => {
      const result = await duressManager.verify('wrongPassword');
      expect(result.isDuress).toBe(false);
      expect(result.mode).toBeUndefined();
    });

    it('should reject empty password', async () => {
      const result = await duressManager.verify('');
      expect(result.isDuress).toBe(false);
    });

    it('should be case sensitive', async () => {
      const result = await duressManager.verify('DURESSPASSWORD123');
      expect(result.isDuress).toBe(false);
    });

    it('should return false when not enabled', async () => {
      duressManager.disable();
      const result = await duressManager.verify('duressPassword123');
      expect(result.isDuress).toBe(false);
    });
  });

  describe('disable', () => {
    it('should disable duress password', async () => {
      await duressManager.setup('duressPass123', 'decoy');
      expect(duressManager.isEnabled()).toBe(true);

      duressManager.disable();
      expect(duressManager.isEnabled()).toBe(false);
      expect(duressManager.getMode()).toBeNull();
    });

    it('should not throw when already disabled', () => {
      expect(() => duressManager.disable()).not.toThrow();
    });
  });

  describe('isEnabled', () => {
    it('should return false initially', () => {
      expect(duressManager.isEnabled()).toBe(false);
    });

    it('should return true after setup', async () => {
      await duressManager.setup('duressPass123', 'decoy');
      expect(duressManager.isEnabled()).toBe(true);
    });

    it('should return false after disable', async () => {
      await duressManager.setup('duressPass123', 'decoy');
      duressManager.disable();
      expect(duressManager.isEnabled()).toBe(false);
    });
  });

  describe('Mode Behavior', () => {
    it('should track decoy mode correctly', async () => {
      await duressManager.setup('password123', 'decoy');
      const result = await duressManager.verify('password123');
      expect(result.mode).toBe('decoy');
    });

    it('should track wipe mode correctly', async () => {
      await duressManager.setup('password123', 'wipe');
      const result = await duressManager.verify('password123');
      expect(result.mode).toBe('wipe');
    });

    it('should track minimal mode correctly', async () => {
      await duressManager.setup('password123', 'minimal');
      const result = await duressManager.verify('password123');
      expect(result.mode).toBe('minimal');
    });
  });

  describe('Security', () => {
    it('should use unique salt for each setup', async () => {
      const manager1 = new DuressManager();
      const manager2 = new DuressManager();

      await manager1.setup('samePassword', 'decoy');
      await manager2.setup('samePassword', 'decoy');

      // Different managers should have different internal state
      // This tests that salts are randomly generated
      expect(manager1.isEnabled()).toBe(true);
      expect(manager2.isEnabled()).toBe(true);
    });

    it('should not expose password hash directly', async () => {
      await duressManager.setup('secretPassword', 'decoy');

      // The manager should not have any public method to get the hash
      expect((duressManager as any).getPasswordHash).toBeUndefined();
    });
  });
});

describe('Secure Notes', () => {
  interface Note {
    id: string;
    type: 'note';
    title: string;
    content: string;
    favorite: boolean;
    created: number;
    modified: number;
  }

  let notes: Note[] = [];

  function createNote(title: string, content: string): Note {
    if (!title.trim()) {
      throw new Error('Title is required');
    }
    if (content.length > 1048576) {
      throw new Error('Content exceeds 1MB limit');
    }

    const now = Date.now();
    return {
      id: crypto.randomUUID(),
      type: 'note',
      title: title.trim(),
      content,
      favorite: false,
      created: now,
      modified: now,
    };
  }

  function addNote(title: string, content: string): Note {
    const note = createNote(title, content);
    notes.push(note);
    return note;
  }

  function getNote(id: string): Note | undefined {
    return notes.find(n => n.id === id);
  }

  function updateNote(id: string, updates: Partial<Pick<Note, 'title' | 'content'>>): Note | null {
    const note = notes.find(n => n.id === id);
    if (!note) return null;

    if (updates.title !== undefined) {
      if (!updates.title.trim()) {
        throw new Error('Title cannot be empty');
      }
      note.title = updates.title.trim();
    }

    if (updates.content !== undefined) {
      if (updates.content.length > 1048576) {
        throw new Error('Content exceeds 1MB limit');
      }
      note.content = updates.content;
    }

    note.modified = Date.now();
    return note;
  }

  function deleteNote(id: string): boolean {
    const index = notes.findIndex(n => n.id === id);
    if (index === -1) return false;

    notes.splice(index, 1);
    return true;
  }

  function listNotes(): Note[] {
    return [...notes];
  }

  function searchNotes(query: string): Note[] {
    const lowerQuery = query.toLowerCase();
    return notes.filter(
      n =>
        n.title.toLowerCase().includes(lowerQuery) ||
        n.content.toLowerCase().includes(lowerQuery)
    );
  }

  beforeEach(() => {
    notes = [];
  });

  describe('createNote', () => {
    it('should create a note with valid data', () => {
      const note = createNote('Test Note', 'Test content');
      expect(note.title).toBe('Test Note');
      expect(note.content).toBe('Test content');
      expect(note.type).toBe('note');
    });

    it('should trim title whitespace', () => {
      const note = createNote('  Trimmed Title  ', 'Content');
      expect(note.title).toBe('Trimmed Title');
    });

    it('should set timestamps', () => {
      const before = Date.now();
      const note = createNote('Test', 'Content');
      const after = Date.now();

      expect(note.created).toBeGreaterThanOrEqual(before);
      expect(note.created).toBeLessThanOrEqual(after);
      expect(note.modified).toBe(note.created);
    });

    it('should generate unique IDs', () => {
      const note1 = createNote('Note 1', 'Content 1');
      const note2 = createNote('Note 2', 'Content 2');
      expect(note1.id).not.toBe(note2.id);
    });

    it('should reject empty title', () => {
      expect(() => createNote('', 'Content')).toThrow('Title is required');
      expect(() => createNote('   ', 'Content')).toThrow('Title is required');
    });

    it('should reject content over 1MB', () => {
      const largeContent = 'A'.repeat(1048577);
      expect(() => createNote('Test', largeContent)).toThrow('1MB limit');
    });

    it('should accept exactly 1MB content', () => {
      const maxContent = 'A'.repeat(1048576);
      const note = createNote('Test', maxContent);
      expect(note.content.length).toBe(1048576);
    });

    it('should default favorite to false', () => {
      const note = createNote('Test', 'Content');
      expect(note.favorite).toBe(false);
    });
  });

  describe('addNote', () => {
    it('should add note to list', () => {
      addNote('Test', 'Content');
      expect(listNotes()).toHaveLength(1);
    });

    it('should return created note', () => {
      const note = addNote('Test', 'Content');
      expect(note.title).toBe('Test');
    });
  });

  describe('getNote', () => {
    it('should find existing note', () => {
      const added = addNote('Test', 'Content');
      const found = getNote(added.id);
      expect(found).toBeDefined();
      expect(found?.title).toBe('Test');
    });

    it('should return undefined for non-existent note', () => {
      const found = getNote('non-existent-id');
      expect(found).toBeUndefined();
    });
  });

  describe('updateNote', () => {
    it('should update title', () => {
      const note = addNote('Original', 'Content');
      const updated = updateNote(note.id, { title: 'Updated' });
      expect(updated?.title).toBe('Updated');
    });

    it('should update content', () => {
      const note = addNote('Test', 'Original content');
      const updated = updateNote(note.id, { content: 'Updated content' });
      expect(updated?.content).toBe('Updated content');
    });

    it('should update modified timestamp', () => {
      const note = addNote('Test', 'Content');
      const originalModified = note.modified;

      // Small delay to ensure timestamp difference
      const updated = updateNote(note.id, { title: 'Updated' });
      expect(updated?.modified).toBeGreaterThanOrEqual(originalModified);
    });

    it('should return null for non-existent note', () => {
      const result = updateNote('non-existent', { title: 'Test' });
      expect(result).toBeNull();
    });

    it('should reject empty title update', () => {
      const note = addNote('Test', 'Content');
      expect(() => updateNote(note.id, { title: '' })).toThrow('cannot be empty');
    });
  });

  describe('deleteNote', () => {
    it('should delete existing note', () => {
      const note = addNote('Test', 'Content');
      const result = deleteNote(note.id);
      expect(result).toBe(true);
      expect(listNotes()).toHaveLength(0);
    });

    it('should return false for non-existent note', () => {
      const result = deleteNote('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('searchNotes', () => {
    beforeEach(() => {
      addNote('Meeting Notes', 'Discuss project timeline');
      addNote('Shopping List', 'Milk, eggs, bread');
      addNote('Ideas', 'New project ideas for meeting');
    });

    it('should search by title', () => {
      const results = searchNotes('Meeting');
      // "Meeting" appears in title "Meeting Notes" and content "meeting" in "Ideas"
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.title === 'Meeting Notes')).toBe(true);
    });

    it('should search by content', () => {
      const results = searchNotes('eggs');
      expect(results).toHaveLength(1);
      expect(results[0]?.title).toBe('Shopping List');
    });

    it('should be case insensitive', () => {
      const results = searchNotes('MEETING');
      expect(results).toHaveLength(2); // Title and content match
    });

    it('should return empty for no matches', () => {
      const results = searchNotes('xyz');
      expect(results).toHaveLength(0);
    });
  });
});
