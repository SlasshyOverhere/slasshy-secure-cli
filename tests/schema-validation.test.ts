/**
 * Schema Validation Tests
 *
 * Tests for Zod schema validation of entries, notes, files, and TOTP data.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definitions (matching the actual schemas)
const EntryType = z.enum(['password', 'file', 'note']);

const TOTPDataSchema = z.object({
  secret: z.string().min(16).max(256),
  issuer: z.string().max(128).optional(),
  algorithm: z.enum(['SHA1', 'SHA256', 'SHA512']).optional(),
  digits: z.number().int().min(6).max(8).optional(),
  period: z.number().int().min(15).max(120).optional(),
});

const EntrySchema = z.object({
  id: z.string().uuid(),
  type: EntryType.default('password'),
  title: z.string().min(1).max(256),
  username: z.string().max(256).optional(),
  password: z.string().max(4096).optional(),
  url: z.string().url().max(2048).optional().or(z.literal('')),
  notes: z.string().max(65536).optional(),
  favorite: z.boolean().default(false),
  category: z.string().max(64).optional(),
  passwordLastChanged: z.number().int().positive().optional(),
  passwordExpiryDays: z.number().int().positive().optional(),
  totp: TOTPDataSchema.optional(),
  created: z.number().int().positive(),
  modified: z.number().int().positive(),
});

const NoteEntrySchema = z.object({
  id: z.string().uuid(),
  type: z.literal('note'),
  title: z.string().min(1).max(256),
  content: z.string().max(1048576),
  favorite: z.boolean().default(false),
  created: z.number().int().positive(),
  modified: z.number().int().positive(),
});

const FileEntrySchema = z.object({
  id: z.string().uuid(),
  type: z.literal('file'),
  title: z.string().min(1).max(256),
  originalName: z.string().min(1).max(512),
  mimeType: z.string().max(256),
  size: z.number().int().nonnegative(),
  checksum: z.string(),
  notes: z.string().max(65536).optional(),
  favorite: z.boolean().default(false),
  created: z.number().int().positive(),
  modified: z.number().int().positive(),
});

const IndexEntrySchema = z.object({
  titleEncrypted: z.string(),
  entryType: EntryType.default('password'),
  fragments: z.array(z.string()),
  carrierType: z.enum(['png', 'jpg', 'decoy']),
  localPath: z.string().optional(),
  fileSize: z.number().int().nonnegative().optional(),
  mimeType: z.string().optional(),
  chunkCount: z.number().int().nonnegative().optional(),
  favorite: z.boolean().default(false),
  category: z.string().max(64).optional(),
  created: z.number().int().positive(),
  modified: z.number().int().positive(),
});

describe('Entry Schema Validation', () => {
  const validEntry = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    type: 'password',
    title: 'Test Entry',
    username: 'user@example.com',
    password: 'securePassword123!',
    url: 'https://example.com',
    notes: 'Some notes',
    favorite: false,
    category: 'work',
    created: Date.now(),
    modified: Date.now(),
  };

  describe('valid entries', () => {
    it('should validate a complete entry', () => {
      const result = EntrySchema.safeParse(validEntry);
      expect(result.success).toBe(true);
    });

    it('should validate entry with minimal fields', () => {
      const minimal = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Minimal Entry',
        created: Date.now(),
        modified: Date.now(),
      };
      const result = EntrySchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });

    it('should validate entry with TOTP data', () => {
      const withTotp = {
        ...validEntry,
        totp: {
          secret: 'JBSWY3DPEHPK3PXP',
          issuer: 'Example',
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
        },
      };
      const result = EntrySchema.safeParse(withTotp);
      expect(result.success).toBe(true);
    });

    it('should validate entry with empty URL', () => {
      const withEmptyUrl = { ...validEntry, url: '' };
      const result = EntrySchema.safeParse(withEmptyUrl);
      expect(result.success).toBe(true);
    });

    it('should default type to password', () => {
      const withoutType = { ...validEntry };
      delete (withoutType as any).type;
      const result = EntrySchema.parse(withoutType);
      expect(result.type).toBe('password');
    });

    it('should default favorite to false', () => {
      const withoutFavorite = { ...validEntry };
      delete (withoutFavorite as any).favorite;
      const result = EntrySchema.parse(withoutFavorite);
      expect(result.favorite).toBe(false);
    });
  });

  describe('invalid entries', () => {
    it('should reject invalid UUID', () => {
      const invalid = { ...validEntry, id: 'not-a-uuid' };
      const result = EntrySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject empty title', () => {
      const invalid = { ...validEntry, title: '' };
      const result = EntrySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject title over 256 characters', () => {
      const invalid = { ...validEntry, title: 'a'.repeat(257) };
      const result = EntrySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject invalid URL', () => {
      const invalid = { ...validEntry, url: 'not-a-url' };
      const result = EntrySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject password over 4096 characters', () => {
      const invalid = { ...validEntry, password: 'a'.repeat(4097) };
      const result = EntrySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject negative timestamps', () => {
      const invalid = { ...validEntry, created: -1 };
      const result = EntrySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject invalid entry type', () => {
      const invalid = { ...validEntry, type: 'invalid' };
      const result = EntrySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});

describe('TOTP Schema Validation', () => {
  describe('valid TOTP data', () => {
    it('should validate complete TOTP data', () => {
      const valid = {
        secret: 'JBSWY3DPEHPK3PXP',
        issuer: 'Example',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      };
      const result = TOTPDataSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should validate minimal TOTP data', () => {
      const minimal = {
        secret: 'JBSWY3DPEHPK3PXP',
      };
      const result = TOTPDataSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });

    it('should accept SHA256 algorithm', () => {
      const valid = { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA256' };
      const result = TOTPDataSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should accept SHA512 algorithm', () => {
      const valid = { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA512' };
      const result = TOTPDataSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should accept 8 digits', () => {
      const valid = { secret: 'JBSWY3DPEHPK3PXP', digits: 8 };
      const result = TOTPDataSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should accept 60 second period', () => {
      const valid = { secret: 'JBSWY3DPEHPK3PXP', period: 60 };
      const result = TOTPDataSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  describe('invalid TOTP data', () => {
    it('should reject secret under 16 characters', () => {
      const invalid = { secret: 'SHORT' };
      const result = TOTPDataSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject secret over 256 characters', () => {
      const invalid = { secret: 'A'.repeat(257) };
      const result = TOTPDataSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject invalid algorithm', () => {
      const invalid = { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'MD5' };
      const result = TOTPDataSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject digits under 6', () => {
      const invalid = { secret: 'JBSWY3DPEHPK3PXP', digits: 4 };
      const result = TOTPDataSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject digits over 8', () => {
      const invalid = { secret: 'JBSWY3DPEHPK3PXP', digits: 10 };
      const result = TOTPDataSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject period under 15', () => {
      const invalid = { secret: 'JBSWY3DPEHPK3PXP', period: 10 };
      const result = TOTPDataSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject period over 120', () => {
      const invalid = { secret: 'JBSWY3DPEHPK3PXP', period: 180 };
      const result = TOTPDataSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject issuer over 128 characters', () => {
      const invalid = { secret: 'JBSWY3DPEHPK3PXP', issuer: 'A'.repeat(129) };
      const result = TOTPDataSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});

describe('Note Entry Schema Validation', () => {
  const validNote = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    type: 'note' as const,
    title: 'Test Note',
    content: 'This is the note content.',
    favorite: false,
    created: Date.now(),
    modified: Date.now(),
  };

  it('should validate a complete note', () => {
    const result = NoteEntrySchema.safeParse(validNote);
    expect(result.success).toBe(true);
  });

  it('should reject content over 1MB', () => {
    const invalid = { ...validNote, content: 'A'.repeat(1048577) };
    const result = NoteEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject wrong type', () => {
    const invalid = { ...validNote, type: 'password' };
    const result = NoteEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should accept 1MB content exactly', () => {
    const valid = { ...validNote, content: 'A'.repeat(1048576) };
    const result = NoteEntrySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});

describe('File Entry Schema Validation', () => {
  const validFile = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    type: 'file' as const,
    title: 'Test File',
    originalName: 'document.pdf',
    mimeType: 'application/pdf',
    size: 1024,
    checksum: 'abc123def456',
    favorite: false,
    created: Date.now(),
    modified: Date.now(),
  };

  it('should validate a complete file entry', () => {
    const result = FileEntrySchema.safeParse(validFile);
    expect(result.success).toBe(true);
  });

  it('should reject negative size', () => {
    const invalid = { ...validFile, size: -1 };
    const result = FileEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should accept zero size', () => {
    const valid = { ...validFile, size: 0 };
    const result = FileEntrySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should reject empty originalName', () => {
    const invalid = { ...validFile, originalName: '' };
    const result = FileEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject wrong type', () => {
    const invalid = { ...validFile, type: 'password' };
    const result = FileEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Index Entry Schema Validation', () => {
  const validIndex = {
    titleEncrypted: 'encrypted_title_data',
    entryType: 'password' as const,
    fragments: ['frag1', 'frag2'],
    carrierType: 'png' as const,
    favorite: false,
    created: Date.now(),
    modified: Date.now(),
  };

  it('should validate a complete index entry', () => {
    const result = IndexEntrySchema.safeParse(validIndex);
    expect(result.success).toBe(true);
  });

  it('should validate file type index entry', () => {
    const fileIndex = {
      ...validIndex,
      entryType: 'file' as const,
      fileSize: 1024,
      mimeType: 'application/pdf',
      chunkCount: 1,
    };
    const result = IndexEntrySchema.safeParse(fileIndex);
    expect(result.success).toBe(true);
  });

  it('should reject invalid carrier type', () => {
    const invalid = { ...validIndex, carrierType: 'gif' };
    const result = IndexEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should accept empty fragments array', () => {
    const valid = { ...validIndex, fragments: [] };
    const result = IndexEntrySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should accept category', () => {
    const valid = { ...validIndex, category: 'work' };
    const result = IndexEntrySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should reject category over 64 characters', () => {
    const invalid = { ...validIndex, category: 'A'.repeat(65) };
    const result = IndexEntrySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
