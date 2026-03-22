import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const translations: Record<string, string> = {
        'common.error': '错误',
        'common.reload': '重新加载',
        'conversation.welcome.newConversation': '新建对话',
        'conversation.historySearch.tooltip': '搜索历史',
        'conversation.history.batchManage': '批量管理',
        'common.settings': '设置',
      };

      return translations[key] || options?.defaultValue || key;
    },
  }),
}));

vi.mock('../../src/renderer/pages/conversation/preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({
    closePreview: vi.fn(),
  }),
}));

vi.mock('../../src/renderer/context/LayoutContext', () => ({
  useLayoutContext: () => ({
    isMobile: false,
  }),
}));

vi.mock('../../src/renderer/context/ThemeContext', () => ({
  useThemeContext: () => ({
    theme: 'light',
    setTheme: vi.fn(),
  }),
}));

vi.mock('../../src/renderer/context/ProjectModeContext', () => ({
  useProjectModeOptional: () => ({
    isProjectMode: false,
  }),
}));

vi.mock('../../src/renderer/utils/siderTooltip', () => ({
  cleanupSiderTooltips: vi.fn(),
  getSiderTooltipProps: vi.fn(() => ({})),
}));

vi.mock('../../src/renderer/utils/focus', () => ({
  blurActiveElement: vi.fn(),
}));

vi.mock('../../src/renderer/pages/conversation/grouped-history/ConversationSearchPopover', () => ({
  default: () => <button type='button'>搜索历史</button>,
}));

vi.mock('../../src/renderer/pages/conversation/WorkspaceGroupedHistory', () => ({
  default: () => {
    throw new Error('Failed to fetch dynamically imported module');
  },
}));

vi.mock('../../src/renderer/pages/settings/SettingsSider', () => ({
  default: () => <div>Settings Sider</div>,
}));

vi.mock('../../src/renderer/pages/tasks/ProjectSider', () => ({
  default: () => <div>Project Sider</div>,
}));

import Sider from '../../src/renderer/sider';

describe('Sider lazy failures', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('shows a recovery panel instead of blanking the app when workspace history fails', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <Sider />
      </MemoryRouter>
    );

    expect(await screen.findByText('错误')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch dynamically imported module')).toBeInTheDocument();
  });
});
