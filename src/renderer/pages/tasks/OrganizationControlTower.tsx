/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

type OrganizationControlTowerProps = {
  children?: React.ReactNode;
};

const OrganizationControlTower: React.FC<OrganizationControlTowerProps> = ({ children }) => {
  const { t } = useTranslation();

  return (
    <aside className='organization-console__tower'>
      <section className='organization-console__tower-card organization-console__tower-card--ai'>
        <h3 className='organization-console__tower-title'>
          {t('project.console.tower.aiTitle', { defaultValue: 'Organization AI' })}
        </h3>
        <div className='organization-console__tower-body organization-console__tower-body--chat'>
          {children || (
            <p className='organization-console__tower-text'>
              {t('project.console.tower.aiPlaceholder', {
                defaultValue: 'Organization-level control conversation will be connected in the next iteration.',
              })}
            </p>
          )}
        </div>
      </section>
    </aside>
  );
};

export default OrganizationControlTower;
