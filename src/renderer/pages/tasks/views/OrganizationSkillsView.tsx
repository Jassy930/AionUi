/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Empty } from '@arco-design/web-react';
import type { TOrgSkill } from '@/common/types/organization';

type OrganizationSkillsViewProps = {
  skills: TOrgSkill[];
};

const OrganizationSkillsView: React.FC<OrganizationSkillsViewProps> = ({ skills }) => {
  if (!skills.length) {
    return <Empty description='No skills yet' />;
  }

  return (
    <div className='organization-console__list'>
      {skills.map((skill) => (
        <article key={skill.id} className='organization-console__summary-card'>
          <h3>{skill.name}</h3>
          <p>{skill.workflow_unit}</p>
        </article>
      ))}
    </div>
  );
};

export default OrganizationSkillsView;
