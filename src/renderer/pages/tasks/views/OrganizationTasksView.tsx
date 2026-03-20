/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Empty } from '@arco-design/web-react';
import type { TOrgTask } from '@/common/types/organization';

type OrganizationTasksViewProps = {
  tasks: TOrgTask[];
};

const OrganizationTasksView: React.FC<OrganizationTasksViewProps> = ({ tasks }) => {
  if (!tasks.length) {
    return <Empty description='No task contracts yet' />;
  }

  return (
    <div className='organization-console__list'>
      {tasks.map((task) => (
        <article key={task.id} className='organization-console__summary-card'>
          <h3>{task.title}</h3>
          <p>{task.objective}</p>
        </article>
      ))}
    </div>
  );
};

export default OrganizationTasksView;
