import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const translations: Record<string, string> = {
        'common.error': '错误',
        'common.reload': '重新加载',
      };

      return translations[key] || options?.defaultValue || key;
    },
  }),
}));

import RouteErrorBoundary from '@/renderer/components/RouteErrorBoundary';

const BrokenRoute = () => {
  throw new Error('Failed to fetch dynamically imported module');
};

describe('RouteErrorBoundary', () => {
  it('renders a recovery panel when route content throws', () => {
    render(
      <RouteErrorBoundary>
        <BrokenRoute />
      </RouteErrorBoundary>
    );

    expect(screen.getByText('错误')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch dynamically imported module')).toBeInTheDocument();
  });
});
