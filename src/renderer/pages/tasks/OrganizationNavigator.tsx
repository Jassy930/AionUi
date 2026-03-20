/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export type OrganizationConsoleView =
  | 'overview'
  | 'tasks'
  | 'runs'
  | 'artifacts'
  | 'memory'
  | 'eval_specs'
  | 'skills'
  | 'genome_patches'
  | 'governance';

export type OrganizationNavItem = {
  id: OrganizationConsoleView;
  label: string;
  count?: number;
};

type OrganizationNavigatorProps = {
  items: OrganizationNavItem[];
  activeView: OrganizationConsoleView;
  onSelect: (view: OrganizationConsoleView) => void;
};

const OrganizationNavigator: React.FC<OrganizationNavigatorProps> = ({ items, activeView, onSelect }) => {
  return (
    <nav className='organization-console__nav' aria-label='Organization views'>
      {items.map((item) => (
        <button
          key={item.id}
          type='button'
          className={`organization-console__nav-item ${
            activeView === item.id ? 'organization-console__nav-item--active' : ''
          }`}
          onClick={() => onSelect(item.id)}
        >
          <span>{item.label}</span>
          {typeof item.count === 'number' ? (
            <span className='organization-console__nav-count'>{item.count}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
};

export default OrganizationNavigator;
