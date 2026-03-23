/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { collectReferenceKeys } = require('../../scripts/generate-i18n-types');

describe('i18n reference key collection', () => {
  it('includes modules and shared keys used by renderer literal t() calls', () => {
    const keys = new Set(collectReferenceKeys());

    expect(keys.has('project.console.nav.overview')).toBe(true);
    expect(keys.has('task.createConversationFailed')).toBe(true);
    expect(keys.has('viewMode.switchToTask')).toBe(true);
    expect(keys.has('common.refreshSuccess')).toBe(true);
    expect(keys.has('settings.noExternalSources')).toBe(true);
  });
});
