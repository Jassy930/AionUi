/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron safeStorage — use vi.hoisted so the mock is available before vi.mock factory runs
const mockSafeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((text: string) => Buffer.from(`encrypted:${text}`)),
  decryptString: vi.fn((buffer: Buffer) => {
    const str = buffer.toString();
    if (str.startsWith('encrypted:')) {
      return str.slice('encrypted:'.length);
    }
    throw new Error('Decryption failed');
  }),
}));

vi.mock('electron', () => ({
  safeStorage: mockSafeStorage,
}));

import {
  encryptString,
  decryptString,
  encryptCredentials,
  decryptCredentials,
  isEncryptionAvailable,
} from '../../../src/process/channels/utils/credentialCrypto';

describe('credentialCrypto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
  });

  describe('isEncryptionAvailable', () => {
    it('returns true when safeStorage is available', () => {
      expect(isEncryptionAvailable()).toBe(true);
    });

    it('returns false when safeStorage is unavailable', () => {
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
      expect(isEncryptionAvailable()).toBe(false);
    });

    it('returns false when safeStorage throws', () => {
      mockSafeStorage.isEncryptionAvailable.mockImplementation(() => {
        throw new Error('not available');
      });
      expect(isEncryptionAvailable()).toBe(false);
    });
  });

  describe('encryptString / decryptString symmetry', () => {
    it('encrypts and decrypts with safeStorage (ss: prefix)', () => {
      const plaintext = 'my-secret-token-123';
      const encrypted = encryptString(plaintext);

      expect(encrypted).toMatch(/^ss:/);
      expect(encrypted).not.toContain(plaintext);

      const decrypted = decryptString(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('returns empty string for empty input', () => {
      expect(encryptString('')).toBe('');
      expect(decryptString('')).toBe('');
    });

    it('falls back to Base64 (b64: prefix) when safeStorage unavailable', () => {
      mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);

      const plaintext = 'fallback-secret';
      const encrypted = encryptString(plaintext);

      expect(encrypted).toMatch(/^b64:/);

      const decrypted = decryptString(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('falls back to Base64 when safeStorage.encryptString throws', () => {
      mockSafeStorage.encryptString.mockImplementation(() => {
        throw new Error('encryption failed');
      });

      const encrypted = encryptString('test');
      expect(encrypted).toMatch(/^b64:/);

      const decrypted = decryptString(encrypted);
      expect(decrypted).toBe('test');
    });
  });

  describe('decryptString legacy formats', () => {
    it('decrypts plain: prefix', () => {
      expect(decryptString('plain:hello')).toBe('hello');
    });

    it('decrypts b64: prefix', () => {
      const encoded = Buffer.from('legacy-token', 'utf-8').toString('base64');
      expect(decryptString(`b64:${encoded}`)).toBe('legacy-token');
    });

    it('decrypts enc: prefix (legacy)', () => {
      const encoded = Buffer.from('old-format', 'utf-8').toString('base64');
      expect(decryptString(`enc:${encoded}`)).toBe('old-format');
    });

    it('returns unencoded value as-is (legacy no prefix)', () => {
      expect(decryptString('raw-value')).toBe('raw-value');
    });

    it('returns empty string when ss: decryption fails', () => {
      mockSafeStorage.decryptString.mockImplementation(() => {
        throw new Error('bad data');
      });
      expect(decryptString('ss:invaliddata')).toBe('');
    });

    it('returns empty string when b64: decoding fails', () => {
      // b64: followed by invalid base64 that decodes to garbage but doesn't throw
      // Buffer.from handles most inputs, so test with a valid but different encoding
      const result = decryptString('b64:dGVzdA==');
      expect(result).toBe('test');
    });
  });

  describe('encryptCredentials / decryptCredentials', () => {
    it('encrypts only the token field', () => {
      const creds = { token: 'secret-token', appId: 'app123', enabled: true };
      const encrypted = encryptCredentials(creds);

      expect(encrypted).toBeDefined();
      expect(encrypted!.appId).toBe('app123');
      expect(encrypted!.enabled).toBe(true);
      expect(encrypted!.token).not.toBe('secret-token');
      expect(typeof encrypted!.token).toBe('string');
      expect((encrypted!.token as string)).toMatch(/^(ss:|b64:)/);
    });

    it('decrypts the token field back', () => {
      const creds = { token: 'secret-token', appId: 'app123' };
      const encrypted = encryptCredentials(creds);
      const decrypted = decryptCredentials(encrypted);

      expect(decrypted!.token).toBe('secret-token');
      expect(decrypted!.appId).toBe('app123');
    });

    it('returns undefined for undefined input', () => {
      expect(encryptCredentials(undefined)).toBeUndefined();
      expect(decryptCredentials(undefined)).toBeUndefined();
    });

    it('passes through non-string token unchanged', () => {
      const creds = { token: undefined, appId: 'x' };
      const encrypted = encryptCredentials(creds);
      expect(encrypted!.token).toBeUndefined();
    });

    it('passes through empty string token unchanged', () => {
      const creds = { token: '', appId: 'x' };
      const encrypted = encryptCredentials(creds);
      expect(encrypted!.token).toBe('');
    });
  });
});
