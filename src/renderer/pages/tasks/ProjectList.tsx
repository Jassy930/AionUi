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
import type { TProjectWithCount } from '@/common/types/task';
import { getLastDirectoryName } from '@/renderer/utils/workspace';
import './TaskBoard.css';

const ProjectList: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<TProjectWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editingProject, setEditingProject] = useState<TProjectWithCount | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formWorkspace, setFormWorkspace] = useState('');

  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      const result = await ipcBridge.project.list.invoke();
      if (result.success && result.data) {
        setProjects(result.data);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    const unsubs = [
      ipcBridge.project.created.on(() => void loadProjects()),
      ipcBridge.project.updated.on(() => void loadProjects()),
      ipcBridge.project.deleted.on(() => void loadProjects()),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [loadProjects]);

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
      Message.warning(t('project.nameRequired', { defaultValue: 'Project name is required' }));
      return;
    }
    try {
      const result = await ipcBridge.project.create.invoke({
        name: formName.trim(),
        description: formDesc.trim() || undefined,
        workspace: formWorkspace || undefined,
      });
      if (result.success) {
        Message.success(t('project.created', { defaultValue: 'Project created' }));
        setCreateModalVisible(false);
        resetForm();
      } else {
        Message.error(result.msg || t('project.createFailed', { defaultValue: 'Failed to create project' }));
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      Message.error(t('project.createFailed', { defaultValue: 'Failed to create project' }));
    }
  };

  const handleEdit = async () => {
    if (!editingProject || !formName.trim()) return;
    try {
      await ipcBridge.project.update.invoke({
        id: editingProject.id,
        updates: {
          name: formName.trim(),
          description: formDesc.trim() || undefined,
          workspace: formWorkspace || undefined,
        },
      });
      setEditingProject(null);
      resetForm();
    } catch (error) {
      console.error('Failed to update project:', error);
      Message.error(t('project.updateFailed', { defaultValue: 'Failed to update project' }));
    }
  };

  const handleDelete = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    try {
      const result = await ipcBridge.project.delete.invoke({ id: projectId });
      if (result.success) {
        Message.success(t('project.deleted', { defaultValue: 'Project deleted' }));
      } else {
        Message.error(result.msg || t('project.deleteFailed', { defaultValue: 'Failed to delete project' }));
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const openEdit = (e: React.MouseEvent, proj: TProjectWithCount) => {
    e.stopPropagation();
    setEditingProject(proj);
    setFormName(proj.name);
    setFormDesc(proj.description || '');
    setFormWorkspace(proj.workspace);
  };

  const formContent = (
    <div className='task-board__modal-form'>
      <div className='task-board__modal-field'>
        <label>{t('project.name', { defaultValue: 'Project Name' })}</label>
        <Input
          value={formName}
          onChange={setFormName}
          placeholder={t('project.namePlaceholder', { defaultValue: 'Enter project name...' })}
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
            placeholder={t('project.workspaceDefault', { defaultValue: 'Default (AionUi workspace)' })}
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
        <h1 className='task-board__title'>{t('project.listTitle', { defaultValue: 'Projects' })}</h1>
        <Button
          type='primary'
          icon={<Plus theme='outline' />}
          onClick={() => {
            resetForm();
            setCreateModalVisible(true);
          }}
        >
          {t('project.create', { defaultValue: 'New Project' })}
        </Button>
      </div>

      {!loading && projects.length === 0 ? (
        <div className='project-list__empty'>
          <Empty description={t('project.noProjects', { defaultValue: 'No projects yet' })} />
        </div>
      ) : (
        <div className='project-list__grid'>
          {projects.map((proj) => (
            <div
              key={proj.id}
              className='task-board__card project-card'
              onClick={() => void navigate(`/tasks/${proj.id}`)}
              role='button'
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && void navigate(`/tasks/${proj.id}`)}
            >
              <div className='task-board__card-header'>
                <div className='project-card__title-row'>
                  <DocumentFolder
                    theme='outline'
                    size={16}
                    style={{ color: 'var(--color-primary-6)', flexShrink: 0 }}
                  />
                  <h4 className='task-board__card-title'>{proj.name}</h4>
                </div>
                <div className='task-board__card-actions' onClick={(e) => e.stopPropagation()}>
                  <button className='task-board__card-action' onClick={(e) => openEdit(e, proj)}>
                    <Edit theme='outline' size={14} />
                  </button>
                  <button
                    className='task-board__card-action task-board__card-action--danger'
                    onClick={(e) => void handleDelete(e, proj.id)}
                  >
                    <Delete theme='outline' size={14} />
                  </button>
                </div>
              </div>

              {proj.description && <p className='task-board__card-description'>{proj.description}</p>}

              <div className='task-board__card-meta'>
                <span className='task-board__card-workspace' title={proj.workspace}>
                  <FolderOpen theme='outline' size={12} />
                  {getLastDirectoryName(proj.workspace)}
                </span>
                <span className='task-board__card-conversations'>
                  {proj.task_count} {t('project.tasks', { defaultValue: 'tasks' })}
                </span>
                <span className='task-board__card-time'>
                  <Time theme='outline' size={12} />
                  {new Date(proj.updated_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal
        title={t('project.create', { defaultValue: 'New Project' })}
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

      {/* Edit Modal */}
      <Modal
        title={t('project.edit', { defaultValue: 'Edit Project' })}
        visible={!!editingProject}
        onOk={handleEdit}
        onCancel={() => {
          setEditingProject(null);
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
