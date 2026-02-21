/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { emitter } from '@/renderer/utils/emitter';
import { updateWorkspaceTime } from '@/renderer/utils/workspaceHistory';
import { Form, Input, Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useConversationTabs } from '@/renderer/pages/conversation/context/ConversationTabsContext';
import AionModal from './base/AionModal';

interface OpenClawRemoteModalProps {
  visible: boolean;
  onClose: () => void;
  workspace?: string;
  customWorkspace?: boolean;
}

const OpenClawRemoteModal: React.FC<OpenClawRemoteModalProps> = ({ visible, onClose, workspace, customWorkspace }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { closeAllTabs, openTab } = useConversationTabs();
  const [form] = Form.useForm();
  const [connecting, setConnecting] = useState(false);

  // Pre-fill from ~/.openclaw/openclaw.json gateway.remote config
  useEffect(() => {
    if (!visible) return;
    ipcBridge.openclawConversation.getRemoteConfig
      .invoke()
      .then((result) => {
        if (result.success && result.data) {
          const values: Record<string, string> = {};
          if (result.data.url) values.url = result.data.url;
          if (result.data.token) values.token = result.data.token;
          form.setFieldsValue(values);
        }
      })
      .catch(() => {
        // Silently ignore config read failures
      });
  }, [visible, form]);

  const handleConnect = useCallback(async () => {
    try {
      const values = await form.validate();
      const url = (values.url as string)?.trim();
      const token = (values.token as string)?.trim() || undefined;

      if (!url) {
        Message.warning(t('openclaw.remote.urlRequired'));
        return;
      }

      setConnecting(true);

      // Derive a safe display name — hide full IP/port to avoid leaking server info in sidebar
      let displayHost: string;
      try {
        const parsed = new URL(url);
        const h = parsed.hostname;
        // Raw IPv4: keep only first octet (e.g. 198.13.48.23 → 198.***)
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
          displayHost = `${h.split('.')[0]}.***`;
        } else {
          // Domain name: safe to show
          displayHost = h;
        }
      } catch {
        displayHost = 'gateway';
      }

      const conversation = await ipcBridge.conversation.create.invoke({
        type: 'openclaw-gateway',
        name: `OpenClaw Remote (${displayHost})`,
        model: { id: '', platform: '', name: '', baseUrl: '', apiKey: '', useModel: '' } as any,
        extra: {
          workspace,
          customWorkspace,
          gateway: {
            mode: 'remote',
            url,
            token,
          },
        },
      });

      if (!conversation?.id) {
        Message.error('Failed to create OpenClaw conversation');
        return;
      }

      if (customWorkspace && workspace) {
        closeAllTabs();
        updateWorkspaceTime(workspace);
        openTab(conversation);
      }

      emitter.emit('chat.history.refresh');

      // Store initial message placeholder
      sessionStorage.setItem(`openclaw_initial_message_${conversation.id}`, JSON.stringify({ input: '', files: undefined }));

      onClose();
      await navigate(`/conversation/${conversation.id}`);
    } catch (error) {
      if (error instanceof Error) {
        Message.error(error.message);
      }
    } finally {
      setConnecting(false);
    }
  }, [form, t, workspace, customWorkspace, closeAllTabs, openTab, onClose, navigate]);

  return (
    <AionModal visible={visible} onCancel={onClose} header={t('openclaw.remote.title')} footer={null} style={{ width: 480 }} unmountOnExit>
      <div className='p-20px'>
        <Form form={form} layout='vertical' autoComplete='off'>
          <Form.Item label={t('openclaw.remote.url')} field='url' rules={[{ required: true, message: t('openclaw.remote.urlRequired') }]}>
            <Input placeholder={t('openclaw.remote.urlPlaceholder')} />
          </Form.Item>
          <Form.Item label={t('openclaw.remote.token')} field='token'>
            <Input.Password placeholder={t('openclaw.remote.tokenPlaceholder')} />
          </Form.Item>
        </Form>
        <div className='flex justify-end mt-16px'>
          <button className='px-24px py-8px rd-8px text-14px font-medium cursor-pointer border-none text-white' style={{ backgroundColor: 'rgb(var(--primary-6))' }} onClick={handleConnect} disabled={connecting}>
            {connecting ? '...' : t('openclaw.remote.connect')}
          </button>
        </div>
      </div>
    </AionModal>
  );
};

export default OpenClawRemoteModal;
