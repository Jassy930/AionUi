/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

import OrganizationControlTower from '@/renderer/pages/tasks/OrganizationControlTower';

describe('OrganizationControlTower', () => {
  it('marks the AI panel card as a stretchable chat container', () => {
    const { container } = render(
      <OrganizationControlTower>
        <div>Organization AI Panel</div>
      </OrganizationControlTower>
    );

    const aiHeading = screen.getByRole('heading', { name: 'Organization AI' });
    const aiCard = aiHeading.closest('section');
    const aiBody = container.querySelector('.organization-console__tower-body');

    expect(aiCard).toHaveClass('organization-console__tower-card--ai');
    expect(aiBody).toHaveClass('organization-console__tower-body--chat');
  });
});
