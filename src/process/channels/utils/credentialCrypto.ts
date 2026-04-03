/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { safeStorage } from 'electron';

/**
 * Credential storage utilities
 * Uses Electron safeStorage for OS-level encryption (Keychain on macOS, DPAPI on Windows,
 * libsecret on Linux). Falls back to Base64 encoding when safeStorage is unavailable.
 */

/**
 * Check if OS-level encryption is available
 */
export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/**
 * Encrypt a string value for storage using safeStorage (preferred) or Base64 (fallback).
 * @param plaintext - The string to encrypt
 * @returns Encrypted string with prefix (ss: for safeStorage, b64: for Base64 fallback)
 */
export function encryptString(plaintext: string): string {
  if (!plaintext) return '';

  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(plaintext);
      return `ss:${encrypted.toString('base64')}`;
    }
  } catch (error) {
    console.warn('[CredentialStorage] safeStorage encryption failed, falling back to Base64:', error);
  }

  // Fallback to Base64 when safeStorage is unavailable
  try {
    const encoded = Buffer.from(plaintext, 'utf-8').toString('base64');
    return `b64:${encoded}`;
  } catch (error) {
    console.error('[CredentialStorage] Encoding failed:', error);
    return `plain:${plaintext}`;
  }
}

/**
 * Decrypt a previously encrypted string.
 * Supports all formats: ss: (safeStorage), b64: (Base64), enc: (legacy), plain:, and unencoded.
 * @param encoded - The encrypted/encoded string
 * @returns The decrypted plaintext
 */
export function decryptString(encoded: string): string {
  if (!encoded) return '';

  // Handle ss: prefix (safeStorage format)
  if (encoded.startsWith('ss:')) {
    try {
      const buffer = Buffer.from(encoded.slice(3), 'base64');
      return safeStorage.decryptString(buffer);
    } catch (error) {
      console.error('[CredentialStorage] safeStorage decryption failed:', error);
      return '';
    }
  }

  // Handle plain: prefix
  if (encoded.startsWith('plain:')) {
    return encoded.slice(6);
  }

  // Handle b64: prefix
  if (encoded.startsWith('b64:')) {
    try {
      return Buffer.from(encoded.slice(4), 'base64').toString('utf-8');
    } catch (error) {
      console.error('[CredentialStorage] Base64 decoding failed:', error);
      return '';
    }
  }

  // Handle enc: prefix (legacy format)
  if (encoded.startsWith('enc:')) {
    console.warn('[CredentialStorage] Found legacy enc: format, attempting base64 decode');
    try {
      return Buffer.from(encoded.slice(4), 'base64').toString('utf-8');
    } catch {
      console.error('[CredentialStorage] Cannot decode legacy enc: format');
      return '';
    }
  }

  // Legacy: no prefix means it was stored before encoding was added
  console.warn('[CredentialStorage] Found legacy unencoded value, returning as-is');
  return encoded;
}

/**
 * Encrypt credentials object.
 * Only encrypts sensitive fields (token).
 */
export function encryptCredentials(
  credentials: Record<string, string | number | boolean | undefined> | undefined
): Record<string, string | number | boolean | undefined> | undefined {
  if (!credentials) return undefined;

  const token = credentials.token;
  return {
    ...credentials,
    token: typeof token === 'string' && token ? encryptString(token) : token,
  };
}

/**
 * Decrypt credentials object.
 */
export function decryptCredentials(
  credentials: Record<string, string | number | boolean | undefined> | undefined
): Record<string, string | number | boolean | undefined> | undefined {
  if (!credentials) return undefined;

  const token = credentials.token;
  return {
    ...credentials,
    token: typeof token === 'string' && token ? decryptString(token) : token,
  };
}
