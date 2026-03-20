/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Modal, Message, Empty } from '@arco-design/web-react';
import { Plus, Delete, Edit, Time, DocumentFolder, FolderOpen } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type { TOrganization } from '@/common/types/organization';
import { getLastDirectoryName } from '@/renderer/utils/workspace';
import './TaskBoard.css';

const ProjectList: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState<TOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editingOrganization, setEditingOrganization] = useState<TOrganization | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formWorkspace, setFormWorkspace] = useState('');

  const loadOrganizations = useCallback(async () => {
    try {
      setLoading(true);
      const result = await ipcBridge.org.organization.list.invoke();
      if (result.success && result.data) {
        setOrganizations(result.data);
      }
    } catch (error) {
      console.error('Failed to load organizations:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrganizations();
  }, [loadOrganizations]);

  useEffect(() => {
    const unsubs = [
      ipcBridge.org.organization.created.on(() => void loadOrganizations()),
      ipcBridge.org.organization.updated.on(() => void loadOrganizations()),
      ipcBridge.org.organization.deleted.on(() => void loadOrganizations()),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [loadOrganizations]);

  const resetForm = () => {
    setFormName('');
    setFormDesc('');
    setFormWorkspace('');
  };

  const handleSelectWorkspace = async () => {
    try {
      const files = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory'] });
      const selected = files?.[0];
      if (selected) {
        setFormWorkspace(selected);
      }
    } catch (error) {
      console.error('Failed to select workspace:', error);
    }
  };

  const handleCreate = async () => {
    if (!formName.trim()) {
      Message.warning(t('project.nameRequired', { defaultValue: 'Organization name is required' }));
      return;
    }
    if (!formWorkspace.trim()) {
      Message.warning(t('project.workspaceRequired', { defaultValue: 'Workspace is required' }));
      return;
    }

    try {
      const result = await ipcBridge.org.organization.create.invoke({
        name: formName.trim(),
        description: formDesc.trim() || undefined,
        workspace: formWorkspace.trim(),
      });
      if (result.success) {
        Message.success(t('project.created', { defaultValue: 'Organization created' }));
        setCreateModalVisible(false);
        resetForm();
      } else {
        Message.error(result.msg || t('project.createFailed', { defaultValue: 'Failed to create organization' }));
      }
    } catch (error) {
      console.error('Failed to create organization:', error);
      Message.error(t('project.createFailed', { defaultValue: 'Failed to create organization' }));
    }
  };

  const handleEdit = async () => {
    if (!editingOrganization || !formName.trim() || !formWorkspace.trim()) {
      return;
    }

    try {
      const result = await ipcBridge.org.organization.update.invoke({
        id: editingOrganization.id,
        updates: {
          name: formName.trim(),
          description: formDesc.trim() || undefined,
          workspace: formWorkspace.trim(),
        },
      });
      if (!result.success) {
        Message.error(result.msg || t('project.updateFailed', { defaultValue: 'Failed to update organization' }));
        return;
      }
      setEditingOrganization(null);
      resetForm();
    } catch (error) {
      console.error('Failed to update organization:', error);
      Message.error(t('project.updateFailed', { defaultValue: 'Failed to update organization' }));
    }
  };

  const handleDelete = async (e: React.MouseEvent, organizationId: string) => {
    e.stopPropagation();
    try {
      const result = await ipcBridge.org.organization.delete.invoke({ id: organizationId });
      if (result.success) {
        Message.success(t('project.deleted', { defaultValue: 'Organization deleted' }));
      } else {
        Message.error(result.msg || t('project.deleteFailed', { defaultValue: 'Failed to delete organization' }));
      }
    } catch (error) {
      console.error('Failed to delete organization:', error);
    }
  };

  const openEdit = (e: React.MouseEvent, organization: TOrganization) => {
    e.stopPropagation();
    setEditingOrganization(organization);
    setFormName(organization.name);
    setFormDesc(organization.description || '');
    setFormWorkspace(organization.workspace);
  };

  const formContent = (
    <div className='task-board__modal-form'>
      <div className='task-board__modal-field'>
        <label>{t('project.name', { defaultValue: 'Organization Name' })}</label>
        <Input
          value={formName}
          onChange={setFormName}
          placeholder={t('project.namePlaceholder', { defaultValue: 'Enter organization name...' })}
          autoFocus
        />
      </div>
      <div className='task-board__modal-field'>
        <label>{t('project.description', { defaultValue: 'Description' })}</label>
        <Input.TextArea
          value={formDesc}
          onChange={setFormDesc}
          placeholder={t('project.descriptionPlaceholder', { defaultValue: 'Enter description (optional)...' })}
          rows={3}
        />
      </div>
      <div className='task-board__modal-field'>
        <label>{t('project.workspace', { defaultValue: 'Workspace' })}</label>
        <div className='project-form__workspace-picker'>
          <Input
            value={formWorkspace}
            readOnly
            placeholder={t('project.workspaceDefault', { defaultValue: 'Select organization workspace' })}
            onClick={handleSelectWorkspace}
            style={{ cursor: 'pointer' }}
          />
          <Button type='outline' icon={<FolderOpen theme='outline' size={14} />} onClick={handleSelectWorkspace}>
            {t('project.browse', { defaultValue: 'Browse' })}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className='task-board'>
      <div className='task-board__header'>
        <h1 className='task-board__title'>{t('project.listTitle', { defaultValue: 'Organizations' })}</h1>
        <Button
          type='primary'
          icon={<Plus theme='outline' />}
          onClick={() => {
            resetForm();
            setCreateModalVisible(true);
          }}
        >
          {t('project.create', { defaultValue: 'New Organization' })}
        </Button>
      </div>

      {!loading && organizations.length === 0 ? (
        <div className='project-list__empty'>
          <Empty description={t('project.noProjects', { defaultValue: 'No organizations yet' })} />
        </div>
      ) : (
        <div className='project-list__grid'>
          {organizations.map((organization) => (
            <div
              key={organization.id}
              className='task-board__card project-card'
              onClick={() => void navigate(`/tasks/${organization.id}`)}
              role='button'
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && void navigate(`/tasks/${organization.id}`)}
            >
              <div className='task-board__card-header'>
                <div className='project-card__title-row'>
                  <DocumentFolder
                    theme='outline'
                    size={16}
                    style={{ color: 'var(--color-primary-6)', flexShrink: 0 }}
                  />
                  <h4 className='task-board__card-title'>{organization.name}</h4>
                </div>
                <div className='task-board__card-actions' onClick={(e) => e.stopPropagation()}>
                  <button className='task-board__card-action' onClick={(e) => openEdit(e, organization)}>
                    <Edit theme='outline' size={14} />
                  </button>
                  <button
                    className='task-board__card-action task-board__card-action--danger'
                    onClick={(e) => void handleDelete(e, organization.id)}
                  >
                    <Delete theme='outline' size={14} />
                  </button>
                </div>
              </div>

              {organization.description ? (
                <p className='task-board__card-description'>{organization.description}</p>
              ) : null}

              <div className='task-board__card-meta'>
                <span className='task-board__card-workspace' title={organization.workspace}>
                  <FolderOpen theme='outline' size={12} />
                  {getLastDirectoryName(organization.workspace)}
                </span>
                <span className='task-board__card-conversations'>
                  {t('project.organizationBadge', { defaultValue: 'Organization Workspace' })}
                </span>
                <span className='task-board__card-time'>
                  <Time theme='outline' size={12} />
                  {new Date(organization.updated_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        title={t('project.create', { defaultValue: 'New Organization' })}
        visible={createModalVisible}
        onOk={handleCreate}
        onCancel={() => {
          setCreateModalVisible(false);
          resetForm();
        }}
        okText={t('common.create', { defaultValue: 'Create' })}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
      >
        {formContent}
      </Modal>

      <Modal
        title={t('project.edit', { defaultValue: 'Edit Organization' })}
        visible={!!editingOrganization}
        onOk={handleEdit}
        onCancel={() => {
          setEditingOrganization(null);
          resetForm();
        }}
        okText={t('common.save', { defaultValue: 'Save' })}
        cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
      >
        {formContent}
      </Modal>
    </div>
  );
};

export default ProjectList;
