/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ensureDirectory, getDataPath } from '@process/utils';
import type Database from 'better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { runMigrations as executeMigrations } from './migrations';
import { CURRENT_DB_VERSION, getDatabaseVersion, initSchema, setDatabaseVersion } from './schema';
import type {
  IConversationRow,
  IMessageRow,
  IPaginatedResult,
  IQueryResult,
  IUser,
  TChatConversation,
  TMessage,
  TProject,
  IProjectRow,
  TProjectWithCount,
  TTask,
  ITaskRow,
  TTaskWithCount,
} from './types';
import {
  conversationToRow,
  messageToRow,
  rowToConversation,
  rowToMessage,
  projectToRow,
  rowToProject,
  taskToRow,
  rowToTask,
} from './types';
import type { IMessageSearchItem, IMessageSearchResponse } from '@/common/types/database';
import type {
  IChannelPluginConfig,
  IChannelUser,
  IChannelSession,
  IChannelPairingRequest,
  IChannelUserRow,
  IChannelSessionRow,
  IChannelPairingCodeRow,
  PluginType,
  PluginStatus,
} from '@/channels/types';
import type { ConversationSource, TProviderWithModel } from '@/common/storage';
import type {
  IUpdateOrganizationParams,
  IListOrgArtifactParams,
  IListOrgEvalSpecParams,
  IListOrgGenomePatchParams,
  IListOrgMemoryCardParams,
  IListOrgRunParams,
  IListOrgSkillParams,
  IListOrgTaskParams,
  TOrganization,
  TOrgArtifact,
  TOrgEvalSpec,
  TOrgGenomePatch,
  TOrgGovernanceAuditLog,
  TOrgGovernanceAuditLogRecord,
  TOrgMemoryCard,
  TOrgRun,
  TOrgSkill,
  TOrgTask,
} from '@/common/types/organization';
import { rowToChannelUser, rowToChannelSession, rowToPairingRequest } from '@/channels/types';
import { encryptCredentials, decryptCredentials } from '@/channels/utils/credentialCrypto';

type IConversationMessageSearchRow = IConversationRow & {
  message_id: string;
  message_type: TMessage['type'];
  message_content: string;
  message_created_at: number;
};

type IOrgTaskRow = Omit<TOrgTask, 'scope' | 'done_criteria' | 'budget' | 'validators' | 'deliverable_schema'> & {
  scope: string;
  done_criteria: string;
  budget: string;
  validators: string;
  deliverable_schema: string;
};

type IOrgRunRow = Omit<TOrgRun, 'workspace' | 'environment' | 'context_policy' | 'execution' | 'execution_logs'> & {
  workspace: string;
  environment: string;
  context_policy: string | null;
  execution: string | null;
  execution_logs: string | null;
};

type IOrgArtifactRow = Omit<TOrgArtifact, 'metadata'> & {
  metadata: string | null;
};

type IOrgMemoryCardRow = Omit<TOrgMemoryCard, 'traceability' | 'tags'> & {
  traceability: string;
  tags: string | null;
};

type IOrgEvalSpecRow = Omit<TOrgEvalSpec, 'test_commands' | 'quality_gates' | 'baseline_comparison' | 'thresholds'> & {
  test_commands: string;
  quality_gates: string;
  baseline_comparison: string | null;
  thresholds: string | null;
};

type IOrgSkillRow = Omit<TOrgSkill, 'resources'> & {
  resources: string | null;
};

type IOrgGenomePatchRow = Omit<
  TOrgGenomePatch,
  'based_on' | 'proposal' | 'offline_eval_result' | 'canary_result' | 'decision'
> & {
  based_on: string;
  proposal: string;
  offline_eval_result: string | null;
  canary_result: string | null;
  decision: string | null;
};

const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/g, (match) => `\\${match}`);

const toJson = (value: unknown): string => JSON.stringify(value ?? null);

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const extractSearchPreviewText = (rawContent: string): string => {
  const collectStrings = (value: unknown, bucket: string[]): void => {
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized) {
        bucket.push(normalized);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => collectStrings(item, bucket));
      return;
    }

    if (value && typeof value === 'object') {
      Object.values(value).forEach((item) => collectStrings(item, bucket));
    }
  };

  try {
    const parsed = JSON.parse(rawContent);
    const bucket: string[] = [];
    collectStrings(parsed, bucket);
    const previewText = bucket.join(' ').replace(/\s+/g, ' ').trim();
    return previewText || rawContent;
  } catch {
    return rawContent.replace(/\s+/g, ' ').trim();
  }
};

/**
 * Main database class for AionUi
 * Uses better-sqlite3 for fast, synchronous SQLite operations
 */
export class AionUIDatabase {
  private db: Database.Database;
  private readonly defaultUserId = 'system_default_user';
  private readonly systemPasswordPlaceholder = '';

  constructor() {
    const finalPath = path.join(getDataPath(), 'aionui.db');
    console.log(`[Database] Initializing database at: ${finalPath}`);

    const dir = path.dirname(finalPath);
    ensureDirectory(dir);

    try {
      this.db = new BetterSqlite3(finalPath);
      this.initialize();
    } catch (error) {
      console.error('[Database] Failed to initialize, attempting recovery...', error);
      // 尝试恢复：关闭并重新创建数据库
      // Try to recover by closing and recreating database
      try {
        if (this.db) {
          this.db.close();
        }
      } catch (e) {
        // 忽略关闭错误
        // Ignore close errors
      }

      // 备份损坏的数据库文件
      // Backup corrupted database file
      if (fs.existsSync(finalPath)) {
        const backupPath = `${finalPath}.backup.${Date.now()}`;
        try {
          fs.renameSync(finalPath, backupPath);
          console.log(`[Database] Backed up corrupted database to: ${backupPath}`);
        } catch (e) {
          console.error('[Database] Failed to backup corrupted database:', e);
          // 备份失败则尝试直接删除
          // If backup fails, try to delete instead
          try {
            fs.unlinkSync(finalPath);
            console.log(`[Database] Deleted corrupted database file`);
          } catch (e2) {
            console.error('[Database] Failed to delete corrupted database:', e2);
            throw new Error('Database is corrupted and cannot be recovered. Please manually delete: ' + finalPath);
          }
        }
      }

      // 使用新数据库文件重试
      // Retry with fresh database file
      this.db = new BetterSqlite3(finalPath);
      this.initialize();
    }
  }

  private initialize(): void {
    try {
      initSchema(this.db);

      // Check and run migrations if needed
      const currentVersion = getDatabaseVersion(this.db);
      if (currentVersion < CURRENT_DB_VERSION) {
        this.runMigrations(currentVersion, CURRENT_DB_VERSION);
        setDatabaseVersion(this.db, CURRENT_DB_VERSION);
      }

      this.ensureSystemUser();
    } catch (error) {
      console.error('[Database] Initialization failed:', error);
      throw error;
    }
  }

  private runMigrations(from: number, to: number): void {
    executeMigrations(this.db, from, to);
  }

  private ensureSystemUser(): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO users (id, username, email, password_hash, avatar_path, created_at, updated_at, last_login, jwt_secret)
         VALUES (?, ?, NULL, ?, NULL, ?, ?, NULL, NULL)`
      )
      .run(this.defaultUserId, this.defaultUserId, this.systemPasswordPlaceholder, now, now);
  }

  getSystemUser(): IUser | null {
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(this.defaultUserId) as IUser | undefined;
    return user ?? null;
  }

  setSystemUserCredentials(username: string, passwordHash: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE users
         SET username = ?, password_hash = ?, updated_at = ?, created_at = COALESCE(created_at, ?)
         WHERE id = ?`
      )
      .run(username, passwordHash, now, now, this.defaultUserId);
  }

  updateUserUsername(userId: string, username: string): IQueryResult<boolean> {
    try {
      const now = Date.now();
      this.db.prepare('UPDATE users SET username = ?, updated_at = ? WHERE id = ?').run(username, now, userId);
      return {
        success: true,
        data: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: false,
      };
    }
  }
  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * ==================
   * User operations
   * 用户操作
   * ==================
   */

  /**
   * Create a new user in the database
   * 在数据库中创建新用户
   *
   * @param username - Username (unique identifier)
   * @param email - User email (optional)
   * @param passwordHash - Hashed password (use bcrypt)
   * @returns Query result with created user data
   */
  createUser(username: string, email: string | undefined, passwordHash: string): IQueryResult<IUser> {
    try {
      const userId = `user_${Date.now()}`;
      const now = Date.now();

      const stmt = this.db.prepare(`
        INSERT INTO users (id, username, email, password_hash, avatar_path, created_at, updated_at, last_login)
        VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)
      `);

      stmt.run(userId, username, email ?? null, passwordHash, now, now);

      return {
        success: true,
        data: {
          id: userId,
          username,
          email,
          password_hash: passwordHash,
          created_at: now,
          updated_at: now,
          last_login: null,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get user by user ID
   * 通过用户 ID 获取用户信息
   *
   * @param userId - User ID to query
   * @returns Query result with user data or error if not found
   */
  getUser(userId: string): IQueryResult<IUser> {
    try {
      const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as IUser | undefined;

      if (!user) {
        return {
          success: false,
          error: 'User not found',
        };
      }

      return {
        success: true,
        data: user,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get user by username (used for authentication)
   * 通过用户名获取用户信息（用于身份验证）
   *
   * @param username - Username to query
   * @returns Query result with user data or null if not found
   */
  getUserByUsername(username: string): IQueryResult<IUser | null> {
    try {
      const user = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as IUser | undefined;

      return {
        success: true,
        data: user ?? null,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }

  /**
   * Get all users (excluding system default user)
   * 获取所有用户（排除系统默认用户）
   *
   * @returns Query result with array of all users ordered by creation time
   */
  getAllUsers(): IQueryResult<IUser[]> {
    try {
      const stmt = this.db.prepare('SELECT * FROM users ORDER BY created_at ASC');
      const rows = stmt.all() as IUser[];

      return {
        success: true,
        data: rows,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: [],
      };
    }
  }

  /**
   * Get total count of users (excluding system default user)
   * 获取用户总数（排除系统默认用户）
   *
   * @returns Query result with user count
   */
  getUserCount(): IQueryResult<number> {
    try {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM users');
      const row = stmt.get() as { count: number };

      return {
        success: true,
        data: row.count,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: 0,
      };
    }
  }

  /**
   * Check if any users exist in the database
   * 检查数据库中是否存在用户
   *
   * @returns Query result with boolean indicating if users exist
   */
  hasUsers(): IQueryResult<boolean> {
    try {
      // 只统计已设置密码的账户，排除尚未完成初始化的占位行
      // Count only accounts with a non-empty password to ignore placeholder entries
      const stmt = this.db.prepare(
        `SELECT COUNT(*) as count FROM users WHERE password_hash IS NOT NULL AND TRIM(password_hash) != ''`
      );
      const row = stmt.get() as { count: number };
      return {
        success: true,
        data: row.count > 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Update user's last login timestamp
   * 更新用户的最后登录时间戳
   *
   * @param userId - User ID to update
   * @returns Query result with success status
   */
  updateUserLastLogin(userId: string): IQueryResult<boolean> {
    try {
      const now = Date.now();
      this.db.prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?').run(now, now, userId);
      return {
        success: true,
        data: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: false,
      };
    }
  }

  /**
   * Update user's password hash
   * 更新用户的密码哈希
   *
   * @param userId - User ID to update
   * @param newPasswordHash - New hashed password (use bcrypt)
   * @returns Query result with success status
   */
  updateUserPassword(userId: string, newPasswordHash: string): IQueryResult<boolean> {
    try {
      const now = Date.now();
      this.db
        .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(newPasswordHash, now, userId);
      return {
        success: true,
        data: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: false,
      };
    }
  }

  /**
   * Update user's JWT secret
   * 更新用户的 JWT secret
   */
  updateUserJwtSecret(userId: string, jwtSecret: string): IQueryResult<boolean> {
    try {
      const now = Date.now();
      this.db.prepare('UPDATE users SET jwt_secret = ?, updated_at = ? WHERE id = ?').run(jwtSecret, now, userId);
      return {
        success: true,
        data: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: false,
      };
    }
  }

  /**
   * ==================
   * Conversation operations
   * ==================
   */

  createConversation(conversation: TChatConversation, userId?: string): IQueryResult<TChatConversation> {
    try {
      const row = conversationToRow(conversation, userId || this.defaultUserId);

      const stmt = this.db.prepare(`
        INSERT INTO conversations (id, user_id, name, type, extra, model, status, source, channel_chat_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        row.id,
        row.user_id,
        row.name,
        row.type,
        row.extra,
        row.model,
        row.status,
        row.source,
        row.channel_chat_id ?? null,
        row.created_at,
        row.updated_at
      );

      return {
        success: true,
        data: conversation,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  getConversation(conversationId: string): IQueryResult<TChatConversation> {
    try {
      const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as
        | IConversationRow
        | undefined;

      if (!row) {
        return {
          success: false,
          error: 'Conversation not found',
        };
      }

      return {
        success: true,
        data: rowToConversation(row),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Find the latest channel conversation by source, chat ID, type, and optionally backend.
   * Used for per-chat conversation isolation in channel platforms.
   *
   * For ACP conversations, `backend` distinguishes between claude, iflow, codebuddy, etc.
   * (stored in `extra.backend` JSON field).
   */
  findChannelConversation(
    source: ConversationSource,
    channelChatId: string,
    type: string,
    backend?: string,
    userId?: string
  ): IQueryResult<TChatConversation | null> {
    try {
      const finalUserId = userId || this.defaultUserId;

      let row: IConversationRow | undefined;
      if (backend) {
        row = this.db
          .prepare(
            `
            SELECT * FROM conversations
            WHERE user_id = ? AND source = ? AND channel_chat_id = ? AND type = ?
              AND json_extract(extra, '$.backend') = ?
            ORDER BY updated_at DESC
            LIMIT 1
          `
          )
          .get(finalUserId, source, channelChatId, type, backend) as IConversationRow | undefined;
      } else {
        row = this.db
          .prepare(
            `
            SELECT * FROM conversations
            WHERE user_id = ? AND source = ? AND channel_chat_id = ? AND type = ?
            ORDER BY updated_at DESC
            LIMIT 1
          `
          )
          .get(finalUserId, source, channelChatId, type) as IConversationRow | undefined;
      }

      return {
        success: true,
        data: row ? rowToConversation(row) : null,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Batch-update the model field on channel conversations matching source + type.
   * Used when channel settings change to propagate new model to existing conversations.
   */
  updateChannelConversationModel(
    source: 'telegram' | 'lark' | 'dingtalk',
    type: string,
    model: TProviderWithModel,
    userId?: string
  ): IQueryResult<number> {
    try {
      const finalUserId = userId || this.defaultUserId;
      const modelJson = JSON.stringify(model);
      const now = Date.now();
      const stmt = this.db.prepare(`
        UPDATE conversations SET model = ?, updated_at = ?
        WHERE user_id = ? AND source = ? AND type = ?
      `);
      const result = stmt.run(modelJson, now, finalUserId, source, type);
      return { success: true, data: result.changes };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getUserConversations(userId?: string, page = 0, pageSize = 50): IPaginatedResult<TChatConversation> {
    try {
      const finalUserId = userId || this.defaultUserId;

      const countResult = this.db
        .prepare('SELECT COUNT(*) as count FROM conversations WHERE user_id = ?')
        .get(finalUserId) as {
        count: number;
      };

      const rows = this.db
        .prepare(
          `
            SELECT *
            FROM conversations
            WHERE user_id = ?
            ORDER BY updated_at DESC LIMIT ?
            OFFSET ?
          `
        )
        .all(finalUserId, pageSize, page * pageSize) as IConversationRow[];

      return {
        data: rows.map(rowToConversation),
        total: countResult.count,
        page,
        pageSize,
        hasMore: (page + 1) * pageSize < countResult.count,
      };
    } catch (error: any) {
      console.error('[Database] Get conversations error:', error);
      return {
        data: [],
        total: 0,
        page,
        pageSize,
        hasMore: false,
      };
    }
  }

  updateConversation(conversationId: string, updates: Partial<TChatConversation>): IQueryResult<boolean> {
    try {
      const existing = this.getConversation(conversationId);
      if (!existing.success || !existing.data) {
        return {
          success: false,
          error: 'Conversation not found',
        };
      }

      const updated = {
        ...existing.data,
        ...updates,
        modifyTime: Date.now(),
      } as TChatConversation;
      const row = conversationToRow(updated, this.defaultUserId);

      const stmt = this.db.prepare(`
        UPDATE conversations
        SET name       = ?,
            extra      = ?,
            model      = ?,
            status     = ?,
            updated_at = ?
        WHERE id = ?
      `);

      stmt.run(row.name, row.extra, row.model, row.status, row.updated_at, conversationId);

      return {
        success: true,
        data: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  deleteConversation(conversationId: string): IQueryResult<boolean> {
    try {
      const stmt = this.db.prepare('DELETE FROM conversations WHERE id = ?');
      const result = stmt.run(conversationId);

      return {
        success: true,
        data: result.changes > 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * ==================
   * Message operations
   * ==================
   */

  insertMessage(message: TMessage): IQueryResult<TMessage> {
    try {
      const row = messageToRow(message);

      const stmt = this.db.prepare(`
        INSERT INTO messages (id, conversation_id, msg_id, type, content, position, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        row.id,
        row.conversation_id,
        row.msg_id,
        row.type,
        row.content,
        row.position,
        row.status,
        row.created_at
      );

      return {
        success: true,
        data: message,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  getConversationMessages(conversationId: string, page = 0, pageSize = 100, order = 'ASC'): IPaginatedResult<TMessage> {
    try {
      const countResult = this.db
        .prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
        .get(conversationId) as {
        count: number;
      };

      const rows = this.db
        .prepare(
          `
            SELECT *
            FROM messages
            WHERE conversation_id = ?
            ORDER BY created_at ${order} LIMIT ?
            OFFSET ?
          `
        )
        .all(conversationId, pageSize, page * pageSize) as IMessageRow[];

      return {
        data: rows.map(rowToMessage),
        total: countResult.count,
        page,
        pageSize,
        hasMore: (page + 1) * pageSize < countResult.count,
      };
    } catch (error: any) {
      console.error('[Database] Get messages error:', error);
      return {
        data: [],
        total: 0,
        page,
        pageSize,
        hasMore: false,
      };
    }
  }

  searchConversationMessages(keyword: string, userId?: string, page = 0, pageSize = 20): IMessageSearchResponse {
    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
      return {
        items: [],
        total: 0,
        page,
        pageSize,
        hasMore: false,
      };
    }

    try {
      const finalUserId = userId || this.defaultUserId;
      const escapedKeyword = escapeLikePattern(trimmedKeyword);
      const likePattern = `%${escapedKeyword}%`;

      const countResult = this.db
        .prepare(
          `
            SELECT COUNT(*) as count
            FROM messages m
            INNER JOIN conversations c ON c.id = m.conversation_id
            WHERE c.user_id = ?
              AND m.content LIKE ? ESCAPE '\\'
          `
        )
        .get(finalUserId, likePattern) as { count: number };

      const rows = this.db
        .prepare(
          `
            SELECT
              c.id,
              c.user_id,
              c.name,
              c.type,
              c.extra,
              c.model,
              c.status,
              c.source,
              c.channel_chat_id,
              c.created_at,
              c.updated_at,
              m.id as message_id,
              m.type as message_type,
              m.content as message_content,
              m.created_at as message_created_at
            FROM messages m
            INNER JOIN conversations c ON c.id = m.conversation_id
            WHERE c.user_id = ?
              AND m.content LIKE ? ESCAPE '\\'
            ORDER BY m.created_at DESC
            LIMIT ? OFFSET ?
          `
        )
        .all(finalUserId, likePattern, pageSize, page * pageSize) as IConversationMessageSearchRow[];

      const items: IMessageSearchItem[] = rows.map((row) => ({
        conversation: rowToConversation(row),
        messageId: row.message_id,
        messageType: row.message_type,
        messageCreatedAt: row.message_created_at,
        previewText: extractSearchPreviewText(row.message_content),
      }));

      return {
        items,
        total: countResult.count,
        page,
        pageSize,
        hasMore: (page + 1) * pageSize < countResult.count,
      };
    } catch (error: any) {
      console.error('[Database] Search messages error:', error);
      return {
        items: [],
        total: 0,
        page,
        pageSize,
        hasMore: false,
      };
    }
  }

  /**
   * Update a message in the database
   * @param messageId - Message ID to update
   * @param message - Updated message data
   */
  updateMessage(messageId: string, message: TMessage): IQueryResult<boolean> {
    try {
      const row = messageToRow(message);

      const stmt = this.db.prepare(`
        UPDATE messages
        SET type     = ?,
            content  = ?,
            position = ?,
            status   = ?
        WHERE id = ?
      `);

      const result = stmt.run(row.type, row.content, row.position, row.status, messageId);

      return {
        success: true,
        data: result.changes > 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  deleteMessage(messageId: string): IQueryResult<boolean> {
    try {
      const stmt = this.db.prepare('DELETE FROM messages WHERE id = ?');
      const result = stmt.run(messageId);

      return {
        success: true,
        data: result.changes > 0,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  deleteConversationMessages(conversationId: string): IQueryResult<number> {
    try {
      const stmt = this.db.prepare('DELETE FROM messages WHERE conversation_id = ?');
      const result = stmt.run(conversationId);

      return {
        success: true,
        data: result.changes,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get message by msg_id and conversation_id
   * Used for finding existing messages to update (e.g., streaming text accumulation)
   */
  getMessageByMsgId(conversationId: string, msgId: string, type: TMessage['type']): IQueryResult<TMessage | null> {
    try {
      const stmt = this.db.prepare(`
        SELECT *
        FROM messages
        WHERE conversation_id = ?
          AND msg_id = ?
          AND type = ?
        ORDER BY created_at DESC LIMIT 1
      `);

      const row = stmt.get(conversationId, msgId, type) as IMessageRow | undefined;

      return {
        success: true,
        data: row ? rowToMessage(row) : null,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * ==================
   * Channel Plugin operations
   * 个人助手插件操作
   * ==================
   */

  /**
   * Get all assistant plugins
   */
  getChannelPlugins(): IQueryResult<IChannelPluginConfig[]> {
    try {
      const rows = this.db.prepare('SELECT * FROM assistant_plugins ORDER BY created_at ASC').all() as Array<{
        id: string;
        type: string;
        name: string;
        enabled: number;
        config: string;
        status: string | null;
        last_connected: number | null;
        created_at: number;
        updated_at: number;
      }>;

      const plugins: IChannelPluginConfig[] = rows.map((row) => {
        const storedConfig = JSON.parse(row.config || '{}');
        // Decrypt credentials when loading
        const decryptedCredentials = decryptCredentials(storedConfig.credentials);

        return {
          id: row.id,
          type: row.type as PluginType,
          name: row.name,
          enabled: row.enabled === 1,
          credentials: decryptedCredentials,
          config: storedConfig.config,
          status: (row.status as PluginStatus) || 'stopped',
          lastConnected: row.last_connected ?? undefined,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      });

      return { success: true, data: plugins };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Get assistant plugin by ID
   */
  getChannelPlugin(pluginId: string): IQueryResult<IChannelPluginConfig | null> {
    try {
      const row = this.db.prepare('SELECT * FROM assistant_plugins WHERE id = ?').get(pluginId) as
        | {
            id: string;
            type: string;
            name: string;
            enabled: number;
            config: string;
            status: string | null;
            last_connected: number | null;
            created_at: number;
            updated_at: number;
          }
        | undefined;

      if (!row) {
        return { success: true, data: null };
      }

      const storedConfig = JSON.parse(row.config || '{}');
      // Decrypt credentials when loading
      const decryptedCredentials = decryptCredentials(storedConfig.credentials);

      const plugin: IChannelPluginConfig = {
        id: row.id,
        type: row.type as PluginType,
        name: row.name,
        enabled: row.enabled === 1,
        credentials: decryptedCredentials,
        config: storedConfig.config,
        status: (row.status as PluginStatus) || 'stopped',
        lastConnected: row.last_connected ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      return { success: true, data: plugin };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create or update assistant plugin
   */
  upsertChannelPlugin(plugin: IChannelPluginConfig): IQueryResult<boolean> {
    try {
      const now = Date.now();
      const stmt = this.db.prepare(`
        INSERT INTO assistant_plugins (id, type, name, enabled, config, status, last_connected, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          enabled = excluded.enabled,
          config = excluded.config,
          status = excluded.status,
          last_connected = excluded.last_connected,
          updated_at = excluded.updated_at
      `);

      // Encrypt credentials before storing
      const encryptedCredentials = encryptCredentials(plugin.credentials);

      // Store both credentials and config in the config column
      const storedConfig = {
        credentials: encryptedCredentials,
        config: plugin.config,
      };

      stmt.run(
        plugin.id,
        plugin.type,
        plugin.name,
        plugin.enabled ? 1 : 0,
        JSON.stringify(storedConfig),
        plugin.status,
        plugin.lastConnected ?? null,
        plugin.createdAt || now,
        now
      );

      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Update assistant plugin status
   */
  updateChannelPluginStatus(pluginId: string, status: PluginStatus, lastConnected?: number): IQueryResult<boolean> {
    try {
      const now = Date.now();
      this.db
        .prepare(
          'UPDATE assistant_plugins SET status = ?, last_connected = COALESCE(?, last_connected), updated_at = ? WHERE id = ?'
        )
        .run(status, lastConnected ?? null, now, pluginId);
      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete assistant plugin
   */
  deleteChannelPlugin(pluginId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM assistant_plugins WHERE id = ?').run(pluginId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * ==================
   * Channel User operations
   * 个人助手用户操作
   * ==================
   */

  /**
   * Get all authorized assistant users
   */
  getChannelUsers(): IQueryResult<IChannelUser[]> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM assistant_users ORDER BY authorized_at DESC')
        .all() as IChannelUserRow[];
      return { success: true, data: rows.map(rowToChannelUser) };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Get assistant user by platform user ID
   */
  getChannelUserByPlatform(platformUserId: string, platformType: PluginType): IQueryResult<IChannelUser | null> {
    try {
      const row = this.db
        .prepare('SELECT * FROM assistant_users WHERE platform_user_id = ? AND platform_type = ?')
        .get(platformUserId, platformType) as IChannelUserRow | undefined;

      return { success: true, data: row ? rowToChannelUser(row) : null };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create assistant user (authorize)
   */
  createChannelUser(user: IChannelUser): IQueryResult<IChannelUser> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO assistant_users (id, platform_user_id, platform_type, display_name, authorized_at, last_active, session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        user.id,
        user.platformUserId,
        user.platformType,
        user.displayName ?? null,
        user.authorizedAt,
        user.lastActive ?? null,
        user.sessionId ?? null
      );

      return { success: true, data: user };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Update assistant user's last active time
   */
  updateChannelUserActivity(userId: string): IQueryResult<boolean> {
    try {
      const now = Date.now();
      this.db.prepare('UPDATE assistant_users SET last_active = ? WHERE id = ?').run(now, userId);
      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete assistant user (revoke authorization)
   */
  deleteChannelUser(userId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM assistant_users WHERE id = ?').run(userId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * ==================
   * Channel Session operations
   * 个人助手会话操作
   * ==================
   */

  /**
   * Get all active assistant sessions
   */
  getChannelSessions(): IQueryResult<IChannelSession[]> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM assistant_sessions ORDER BY last_activity DESC')
        .all() as IChannelSessionRow[];
      return { success: true, data: rows.map(rowToChannelSession) };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Get assistant session by user ID
   */
  getChannelSessionByUser(userId: string): IQueryResult<IChannelSession | null> {
    try {
      const row = this.db.prepare('SELECT * FROM assistant_sessions WHERE user_id = ?').get(userId) as
        | IChannelSessionRow
        | undefined;
      return { success: true, data: row ? rowToChannelSession(row) : null };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create or update assistant session
   */
  upsertChannelSession(session: IChannelSession): IQueryResult<boolean> {
    try {
      const now = Date.now();
      const stmt = this.db.prepare(`
        INSERT INTO assistant_sessions (id, user_id, agent_type, conversation_id, workspace, chat_id, created_at, last_activity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          agent_type = excluded.agent_type,
          conversation_id = excluded.conversation_id,
          workspace = excluded.workspace,
          chat_id = excluded.chat_id,
          last_activity = excluded.last_activity
      `);

      stmt.run(
        session.id,
        session.userId,
        session.agentType,
        session.conversationId ?? null,
        session.workspace ?? null,
        session.chatId ?? null,
        session.createdAt || now,
        session.lastActivity || now
      );

      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete assistant session
   */
  deleteChannelSession(sessionId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM assistant_sessions WHERE id = ?').run(sessionId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * ==================
   * Channel Pairing Code operations
   * 个人助手配对码操作
   * ==================
   */

  /**
   * Get all pending pairing requests
   */
  getPendingPairingRequests(): IQueryResult<IChannelPairingRequest[]> {
    try {
      const now = Date.now();
      const rows = this.db
        .prepare(
          "SELECT * FROM assistant_pairing_codes WHERE status = 'pending' AND expires_at > ? ORDER BY requested_at DESC"
        )
        .all(now) as IChannelPairingCodeRow[];
      return { success: true, data: rows.map(rowToPairingRequest) };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Get pairing request by code
   */
  getPairingRequestByCode(code: string): IQueryResult<IChannelPairingRequest | null> {
    try {
      const row = this.db.prepare('SELECT * FROM assistant_pairing_codes WHERE code = ?').get(code) as
        | IChannelPairingCodeRow
        | undefined;
      return { success: true, data: row ? rowToPairingRequest(row) : null };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create pairing request
   */
  createPairingRequest(request: IChannelPairingRequest): IQueryResult<IChannelPairingRequest> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO assistant_pairing_codes (code, platform_user_id, platform_type, display_name, requested_at, expires_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        request.code,
        request.platformUserId,
        request.platformType,
        request.displayName ?? null,
        request.requestedAt,
        request.expiresAt,
        request.status
      );

      return { success: true, data: request };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Update pairing request status
   */
  updatePairingRequestStatus(code: string, status: IChannelPairingRequest['status']): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('UPDATE assistant_pairing_codes SET status = ? WHERE code = ?').run(status, code);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete expired pairing requests
   */
  cleanupExpiredPairingRequests(): IQueryResult<number> {
    try {
      const now = Date.now();
      const result = this.db
        .prepare("DELETE FROM assistant_pairing_codes WHERE expires_at < ? OR status != 'pending'")
        .run(now);
      return { success: true, data: result.changes };
    } catch (error: any) {
      return { success: false, error: error.message, data: 0 };
    }
  }

  /**
   * ==================
   * Organization OS operations
   * Organization OS 操作
   * ==================
   */

  createOrganization(organization: TOrganization): IQueryResult<TOrganization> {
    try {
      this.db
        .prepare(
          `
          INSERT INTO organizations (id, name, description, workspace, user_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          organization.id,
          organization.name,
          organization.description ?? null,
          organization.workspace,
          organization.user_id,
          organization.created_at,
          organization.updated_at
        );
      return { success: true, data: organization };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getOrganization(organizationId: string): IQueryResult<TOrganization> {
    try {
      const row = this.db.prepare('SELECT * FROM organizations WHERE id = ?').get(organizationId) as
        | TOrganization
        | undefined;
      if (!row) {
        return { success: false, error: 'Organization not found' };
      }
      return { success: true, data: row };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  listOrganizations(userId?: string): IQueryResult<TOrganization[]> {
    try {
      const finalUserId = userId || this.defaultUserId;
      const rows = this.db
        .prepare('SELECT * FROM organizations WHERE user_id = ? ORDER BY updated_at DESC')
        .all(finalUserId) as TOrganization[];
      return { success: true, data: rows };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  updateOrganization(params: IUpdateOrganizationParams): IQueryResult<boolean> {
    try {
      const existing = this.getOrganization(params.id);
      if (!existing.success) {
        return { success: false, error: 'Organization not found' };
      }

      const now = Date.now();
      const setClauses: string[] = ['updated_at = ?'];
      const sqlParams: (string | number | null)[] = [now];

      if (params.updates.name !== undefined) {
        setClauses.push('name = ?');
        sqlParams.push(params.updates.name);
      }
      if (params.updates.description !== undefined) {
        setClauses.push('description = ?');
        sqlParams.push(params.updates.description ?? null);
      }
      if (params.updates.workspace !== undefined) {
        setClauses.push('workspace = ?');
        sqlParams.push(params.updates.workspace);
      }

      sqlParams.push(params.id);
      this.db.prepare(`UPDATE organizations SET ${setClauses.join(', ')} WHERE id = ?`).run(...sqlParams);

      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  deleteOrganization(organizationId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM organizations WHERE id = ?').run(organizationId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  createOrgTask(task: TOrgTask): IQueryResult<TOrgTask> {
    try {
      this.db
        .prepare(
          `
          INSERT INTO org_tasks (
            id, organization_id, title, objective, scope, done_criteria, budget, risk_tier,
            validators, deliverable_schema, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          task.id,
          task.organization_id,
          task.title,
          task.objective,
          toJson(task.scope),
          toJson(task.done_criteria),
          toJson(task.budget),
          task.risk_tier,
          toJson(task.validators),
          toJson(task.deliverable_schema),
          task.status,
          task.created_at,
          task.updated_at
        );
      return { success: true, data: task };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getOrgTask(taskId: string): IQueryResult<TOrgTask> {
    try {
      const row = this.db.prepare('SELECT * FROM org_tasks WHERE id = ?').get(taskId) as IOrgTaskRow | undefined;
      if (!row) {
        return { success: false, error: 'Organization task not found' };
      }

      const task: TOrgTask = {
        ...row,
        scope: parseJson<string[]>(row.scope, []),
        done_criteria: parseJson<string[]>(row.done_criteria, []),
        budget: parseJson(row.budget, {}),
        validators: parseJson(row.validators, []),
        deliverable_schema: parseJson(row.deliverable_schema, {}),
      };
      return { success: true, data: task };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getOrganizationTasks(params: string | IListOrgTaskParams): IQueryResult<TOrgTask[]> {
    try {
      const organizationId = typeof params === 'string' ? params : params.organization_id;
      const rows = this.db
        .prepare('SELECT * FROM org_tasks WHERE organization_id = ? ORDER BY updated_at DESC')
        .all(organizationId) as IOrgTaskRow[];

      const tasks: TOrgTask[] = rows.map((row) => ({
        ...row,
        scope: parseJson<string[]>(row.scope, []),
        done_criteria: parseJson<string[]>(row.done_criteria, []),
        budget: parseJson(row.budget, {}),
        validators: parseJson(row.validators, []),
        deliverable_schema: parseJson(row.deliverable_schema, {}),
      }));
      return { success: true, data: tasks };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  updateOrgTask(
    taskId: string,
    updates: Partial<
      Pick<
        TOrgTask,
        | 'title'
        | 'objective'
        | 'scope'
        | 'done_criteria'
        | 'budget'
        | 'risk_tier'
        | 'validators'
        | 'deliverable_schema'
        | 'status'
      >
    >
  ): IQueryResult<boolean> {
    try {
      const existing = this.getOrgTask(taskId);
      if (!existing.success) {
        return { success: false, error: 'Organization task not found' };
      }

      const now = Date.now();
      const setClauses: string[] = ['updated_at = ?'];
      const sqlParams: (string | number | null)[] = [now];

      if (updates.title !== undefined) {
        setClauses.push('title = ?');
        sqlParams.push(updates.title);
      }
      if (updates.objective !== undefined) {
        setClauses.push('objective = ?');
        sqlParams.push(updates.objective);
      }
      if (updates.scope !== undefined) {
        setClauses.push('scope = ?');
        sqlParams.push(toJson(updates.scope));
      }
      if (updates.done_criteria !== undefined) {
        setClauses.push('done_criteria = ?');
        sqlParams.push(toJson(updates.done_criteria));
      }
      if (updates.budget !== undefined) {
        setClauses.push('budget = ?');
        sqlParams.push(toJson(updates.budget));
      }
      if (updates.risk_tier !== undefined) {
        setClauses.push('risk_tier = ?');
        sqlParams.push(updates.risk_tier);
      }
      if (updates.validators !== undefined) {
        setClauses.push('validators = ?');
        sqlParams.push(toJson(updates.validators));
      }
      if (updates.deliverable_schema !== undefined) {
        setClauses.push('deliverable_schema = ?');
        sqlParams.push(toJson(updates.deliverable_schema));
      }
      if (updates.status !== undefined) {
        setClauses.push('status = ?');
        sqlParams.push(updates.status);
      }

      sqlParams.push(taskId);
      this.db.prepare(`UPDATE org_tasks SET ${setClauses.join(', ')} WHERE id = ?`).run(...sqlParams);

      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  deleteOrgTask(taskId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM org_tasks WHERE id = ?').run(taskId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  createOrgRun(run: TOrgRun): IQueryResult<TOrgRun> {
    try {
      this.db
        .prepare(
          `
          INSERT INTO org_runs (
            id, organization_id, task_id, status, workspace, environment, context_policy, execution,
            conversation_id, execution_logs, started_at, ended_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          run.id,
          run.organization_id,
          run.task_id,
          run.status,
          toJson(run.workspace),
          toJson(run.environment),
          run.context_policy !== undefined ? toJson(run.context_policy) : null,
          run.execution !== undefined ? toJson(run.execution) : null,
          run.conversation_id ?? null,
          run.execution_logs !== undefined ? toJson(run.execution_logs) : null,
          run.started_at ?? null,
          run.ended_at ?? null,
          run.created_at,
          run.updated_at
        );
      return { success: true, data: run };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getOrgRun(runId: string): IQueryResult<TOrgRun> {
    try {
      const row = this.db.prepare('SELECT * FROM org_runs WHERE id = ?').get(runId) as IOrgRunRow | undefined;
      if (!row) {
        return { success: false, error: 'Organization run not found' };
      }

      const run: TOrgRun = {
        ...row,
        workspace: parseJson(row.workspace, { mode: 'isolated' }),
        environment: parseJson(row.environment, {}),
        context_policy: parseJson(row.context_policy, undefined),
        execution: parseJson(row.execution, undefined),
        execution_logs: parseJson(row.execution_logs, undefined),
      };
      return { success: true, data: run };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  listOrgRuns(params: IListOrgRunParams = {}): IQueryResult<TOrgRun[]> {
    try {
      const where: string[] = [];
      const sqlParams: Array<string | number> = [];

      if (params.organization_id) {
        where.push('organization_id = ?');
        sqlParams.push(params.organization_id);
      }
      if (params.task_id) {
        where.push('task_id = ?');
        sqlParams.push(params.task_id);
      }
      if (params.status) {
        where.push('status = ?');
        sqlParams.push(params.status);
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const rows = this.db
        .prepare(`SELECT * FROM org_runs ${whereClause} ORDER BY created_at DESC`)
        .all(...sqlParams) as IOrgRunRow[];

      const runs: TOrgRun[] = rows.map((row) => ({
        ...row,
        workspace: parseJson(row.workspace, { mode: 'isolated' }),
        environment: parseJson(row.environment, {}),
        context_policy: parseJson(row.context_policy, undefined),
        execution: parseJson(row.execution, undefined),
        execution_logs: parseJson(row.execution_logs, undefined),
      }));

      return { success: true, data: runs };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  updateOrgRun(
    runId: string,
    updates: Partial<
      Pick<
        TOrgRun,
        | 'status'
        | 'workspace'
        | 'environment'
        | 'context_policy'
        | 'execution'
        | 'conversation_id'
        | 'execution_logs'
        | 'started_at'
        | 'ended_at'
      >
    >
  ): IQueryResult<boolean> {
    try {
      const existing = this.getOrgRun(runId);
      if (!existing.success) {
        return { success: false, error: 'Organization run not found' };
      }

      const now = Date.now();
      const setClauses: string[] = ['updated_at = ?'];
      const sqlParams: (string | number | null)[] = [now];

      if (updates.status !== undefined) {
        setClauses.push('status = ?');
        sqlParams.push(updates.status);
      }
      if (updates.workspace !== undefined) {
        setClauses.push('workspace = ?');
        sqlParams.push(toJson(updates.workspace));
      }
      if (updates.environment !== undefined) {
        setClauses.push('environment = ?');
        sqlParams.push(toJson(updates.environment));
      }
      if (updates.context_policy !== undefined) {
        setClauses.push('context_policy = ?');
        sqlParams.push(toJson(updates.context_policy));
      }
      if (updates.execution !== undefined) {
        setClauses.push('execution = ?');
        sqlParams.push(toJson(updates.execution));
      }
      if (updates.conversation_id !== undefined) {
        setClauses.push('conversation_id = ?');
        sqlParams.push(updates.conversation_id ?? null);
      }
      if (updates.execution_logs !== undefined) {
        setClauses.push('execution_logs = ?');
        sqlParams.push(toJson(updates.execution_logs));
      }
      if (updates.started_at !== undefined) {
        setClauses.push('started_at = ?');
        sqlParams.push(updates.started_at ?? null);
      }
      if (updates.ended_at !== undefined) {
        setClauses.push('ended_at = ?');
        sqlParams.push(updates.ended_at ?? null);
      }

      sqlParams.push(runId);
      this.db.prepare(`UPDATE org_runs SET ${setClauses.join(', ')} WHERE id = ?`).run(...sqlParams);

      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  deleteOrgRun(runId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM org_runs WHERE id = ?').run(runId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  associateConversationWithOrgRun(
    conversationId: string,
    organizationId: string | null,
    runId: string | null
  ): IQueryResult<boolean> {
    try {
      const conversationExists = this.db.prepare('SELECT id FROM conversations WHERE id = ?').get(conversationId) as
        | { id: string }
        | undefined;
      if (!conversationExists) {
        return { success: false, error: 'Conversation not found' };
      }

      let resolvedOrganizationId = organizationId;
      if (runId) {
        const runResult = this.getOrgRun(runId);
        if (!runResult.success || !runResult.data) {
          return { success: false, error: 'Organization run not found' };
        }

        const runOrganizationId = runResult.data.organization_id;
        if (organizationId && organizationId !== runOrganizationId) {
          return {
            success: false,
            error: 'Organization mismatch: organizationId does not match run.organization_id',
          };
        }

        // When run is provided, always derive organization from the run to avoid cross-org drift.
        resolvedOrganizationId = runOrganizationId;
      }

      const now = Date.now();
      const result = this.db
        .prepare('UPDATE conversations SET organization_id = ?, run_id = ?, updated_at = ? WHERE id = ?')
        .run(resolvedOrganizationId, runId, now, conversationId);

      if (result.changes === 0) {
        return { success: false, error: 'Conversation not found' };
      }

      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getRunConversations(runId: string): IQueryResult<TChatConversation[]> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM conversations WHERE run_id = ? ORDER BY updated_at DESC')
        .all(runId) as IConversationRow[];
      return { success: true, data: rows.map(rowToConversation) };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  createOrgArtifact(artifact: TOrgArtifact): IQueryResult<TOrgArtifact> {
    try {
      this.db
        .prepare(
          `
          INSERT INTO org_artifacts (
            id, organization_id, task_id, run_id, type, title, summary, content_ref, metadata, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          artifact.id,
          artifact.organization_id,
          artifact.task_id,
          artifact.run_id,
          artifact.type,
          artifact.title,
          artifact.summary ?? null,
          artifact.content_ref ?? null,
          artifact.metadata !== undefined ? toJson(artifact.metadata) : null,
          artifact.created_at,
          artifact.updated_at
        );
      return { success: true, data: artifact };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getOrgArtifact(artifactId: string): IQueryResult<TOrgArtifact> {
    try {
      const row = this.db.prepare('SELECT * FROM org_artifacts WHERE id = ?').get(artifactId) as
        | IOrgArtifactRow
        | undefined;
      if (!row) {
        return { success: false, error: 'Organization artifact not found' };
      }
      return {
        success: true,
        data: {
          ...row,
          metadata: parseJson(row.metadata, undefined),
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  listOrgArtifacts(params: IListOrgArtifactParams = {}): IQueryResult<TOrgArtifact[]> {
    try {
      const where: string[] = [];
      const sqlParams: string[] = [];

      if (params.run_id) {
        where.push('run_id = ?');
        sqlParams.push(params.run_id);
      }
      if (params.task_id) {
        where.push('task_id = ?');
        sqlParams.push(params.task_id);
      }
      if (params.type) {
        where.push('type = ?');
        sqlParams.push(params.type);
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const rows = this.db
        .prepare(`SELECT * FROM org_artifacts ${whereClause} ORDER BY created_at DESC`)
        .all(...sqlParams) as IOrgArtifactRow[];

      return {
        success: true,
        data: rows.map((row) => ({
          ...row,
          metadata: parseJson(row.metadata, undefined),
        })),
      };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  updateOrgArtifact(
    artifactId: string,
    updates: Partial<Pick<TOrgArtifact, 'type' | 'title' | 'summary' | 'content_ref' | 'metadata'>>
  ): IQueryResult<boolean> {
    try {
      const existing = this.getOrgArtifact(artifactId);
      if (!existing.success) {
        return { success: false, error: 'Organization artifact not found' };
      }

      const now = Date.now();
      const setClauses: string[] = ['updated_at = ?'];
      const sqlParams: (string | number | null)[] = [now];

      if (updates.type !== undefined) {
        setClauses.push('type = ?');
        sqlParams.push(updates.type);
      }
      if (updates.title !== undefined) {
        setClauses.push('title = ?');
        sqlParams.push(updates.title);
      }
      if (updates.summary !== undefined) {
        setClauses.push('summary = ?');
        sqlParams.push(updates.summary ?? null);
      }
      if (updates.content_ref !== undefined) {
        setClauses.push('content_ref = ?');
        sqlParams.push(updates.content_ref ?? null);
      }
      if (updates.metadata !== undefined) {
        setClauses.push('metadata = ?');
        sqlParams.push(toJson(updates.metadata));
      }

      sqlParams.push(artifactId);
      this.db.prepare(`UPDATE org_artifacts SET ${setClauses.join(', ')} WHERE id = ?`).run(...sqlParams);
      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  deleteOrgArtifact(artifactId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM org_artifacts WHERE id = ?').run(artifactId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  createOrgMemoryCard(memoryCard: TOrgMemoryCard): IQueryResult<TOrgMemoryCard> {
    try {
      this.db
        .prepare(
          `
          INSERT INTO org_memory_cards (
            id, organization_id, type, title, knowledge_unit, traceability, tags, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          memoryCard.id,
          memoryCard.organization_id,
          memoryCard.type,
          memoryCard.title,
          memoryCard.knowledge_unit,
          toJson(memoryCard.traceability),
          memoryCard.tags !== undefined ? toJson(memoryCard.tags) : null,
          memoryCard.created_at,
          memoryCard.updated_at
        );
      return { success: true, data: memoryCard };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getOrgMemoryCard(cardId: string): IQueryResult<TOrgMemoryCard> {
    try {
      const row = this.db.prepare('SELECT * FROM org_memory_cards WHERE id = ?').get(cardId) as
        | IOrgMemoryCardRow
        | undefined;
      if (!row) {
        return { success: false, error: 'Organization memory card not found' };
      }
      return {
        success: true,
        data: {
          ...row,
          traceability: parseJson(row.traceability, { source_run_ids: [] }),
          tags: parseJson(row.tags, undefined),
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  listOrgMemoryCards(params: IListOrgMemoryCardParams): IQueryResult<TOrgMemoryCard[]> {
    try {
      const where: string[] = ['organization_id = ?'];
      const sqlParams: string[] = [params.organization_id];
      if (params.type) {
        where.push('type = ?');
        sqlParams.push(params.type);
      }

      const rows = this.db
        .prepare(`SELECT * FROM org_memory_cards WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`)
        .all(...sqlParams) as IOrgMemoryCardRow[];

      return {
        success: true,
        data: rows.map((row) => ({
          ...row,
          traceability: parseJson(row.traceability, { source_run_ids: [] }),
          tags: parseJson(row.tags, undefined),
        })),
      };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  updateOrgMemoryCard(
    cardId: string,
    updates: Partial<Pick<TOrgMemoryCard, 'type' | 'title' | 'knowledge_unit' | 'traceability' | 'tags'>>
  ): IQueryResult<boolean> {
    try {
      const existing = this.getOrgMemoryCard(cardId);
      if (!existing.success) {
        return { success: false, error: 'Organization memory card not found' };
      }

      const now = Date.now();
      const setClauses: string[] = ['updated_at = ?'];
      const sqlParams: (string | number | null)[] = [now];

      if (updates.type !== undefined) {
        setClauses.push('type = ?');
        sqlParams.push(updates.type);
      }
      if (updates.title !== undefined) {
        setClauses.push('title = ?');
        sqlParams.push(updates.title);
      }
      if (updates.knowledge_unit !== undefined) {
        setClauses.push('knowledge_unit = ?');
        sqlParams.push(updates.knowledge_unit);
      }
      if (updates.traceability !== undefined) {
        setClauses.push('traceability = ?');
        sqlParams.push(toJson(updates.traceability));
      }
      if (updates.tags !== undefined) {
        setClauses.push('tags = ?');
        sqlParams.push(toJson(updates.tags));
      }

      sqlParams.push(cardId);
      this.db.prepare(`UPDATE org_memory_cards SET ${setClauses.join(', ')} WHERE id = ?`).run(...sqlParams);
      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  deleteOrgMemoryCard(cardId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM org_memory_cards WHERE id = ?').run(cardId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  createOrgEvalSpec(evalSpec: TOrgEvalSpec): IQueryResult<TOrgEvalSpec> {
    try {
      this.db
        .prepare(
          `
          INSERT INTO org_eval_specs (
            id, organization_id, name, description, test_commands, quality_gates,
            baseline_comparison, thresholds, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          evalSpec.id,
          evalSpec.organization_id,
          evalSpec.name,
          evalSpec.description ?? null,
          toJson(evalSpec.test_commands),
          toJson(evalSpec.quality_gates),
          evalSpec.baseline_comparison !== undefined ? toJson(evalSpec.baseline_comparison) : null,
          evalSpec.thresholds !== undefined ? toJson(evalSpec.thresholds) : null,
          evalSpec.created_at,
          evalSpec.updated_at
        );
      return { success: true, data: evalSpec };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getOrgEvalSpec(evalSpecId: string): IQueryResult<TOrgEvalSpec> {
    try {
      const row = this.db.prepare('SELECT * FROM org_eval_specs WHERE id = ?').get(evalSpecId) as
        | IOrgEvalSpecRow
        | undefined;
      if (!row) {
        return { success: false, error: 'Organization eval spec not found' };
      }
      return {
        success: true,
        data: {
          ...row,
          test_commands: parseJson(row.test_commands, []),
          quality_gates: parseJson(row.quality_gates, []),
          baseline_comparison: parseJson(row.baseline_comparison, undefined),
          thresholds: parseJson(row.thresholds, undefined),
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  listOrgEvalSpecs(params: IListOrgEvalSpecParams): IQueryResult<TOrgEvalSpec[]> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM org_eval_specs WHERE organization_id = ? ORDER BY updated_at DESC')
        .all(params.organization_id) as IOrgEvalSpecRow[];

      return {
        success: true,
        data: rows.map((row) => ({
          ...row,
          test_commands: parseJson(row.test_commands, []),
          quality_gates: parseJson(row.quality_gates, []),
          baseline_comparison: parseJson(row.baseline_comparison, undefined),
          thresholds: parseJson(row.thresholds, undefined),
        })),
      };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  updateOrgEvalSpec(
    evalSpecId: string,
    updates: Partial<
      Pick<
        TOrgEvalSpec,
        'name' | 'description' | 'test_commands' | 'quality_gates' | 'baseline_comparison' | 'thresholds'
      >
    >
  ): IQueryResult<boolean> {
    try {
      const existing = this.getOrgEvalSpec(evalSpecId);
      if (!existing.success) {
        return { success: false, error: 'Organization eval spec not found' };
      }

      const now = Date.now();
      const setClauses: string[] = ['updated_at = ?'];
      const sqlParams: (string | number | null)[] = [now];

      if (updates.name !== undefined) {
        setClauses.push('name = ?');
        sqlParams.push(updates.name);
      }
      if (updates.description !== undefined) {
        setClauses.push('description = ?');
        sqlParams.push(updates.description ?? null);
      }
      if (updates.test_commands !== undefined) {
        setClauses.push('test_commands = ?');
        sqlParams.push(toJson(updates.test_commands));
      }
      if (updates.quality_gates !== undefined) {
        setClauses.push('quality_gates = ?');
        sqlParams.push(toJson(updates.quality_gates));
      }
      if (updates.baseline_comparison !== undefined) {
        setClauses.push('baseline_comparison = ?');
        sqlParams.push(toJson(updates.baseline_comparison));
      }
      if (updates.thresholds !== undefined) {
        setClauses.push('thresholds = ?');
        sqlParams.push(toJson(updates.thresholds));
      }

      sqlParams.push(evalSpecId);
      this.db.prepare(`UPDATE org_eval_specs SET ${setClauses.join(', ')} WHERE id = ?`).run(...sqlParams);
      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  deleteOrgEvalSpec(evalSpecId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM org_eval_specs WHERE id = ?').run(evalSpecId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  createOrgSkill(skill: TOrgSkill): IQueryResult<TOrgSkill> {
    try {
      this.db
        .prepare(
          `
          INSERT INTO org_skills (
            id, organization_id, name, description, workflow_unit, instructions, resources, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          skill.id,
          skill.organization_id,
          skill.name,
          skill.description ?? null,
          skill.workflow_unit,
          skill.instructions ?? null,
          skill.resources !== undefined ? toJson(skill.resources) : null,
          skill.version,
          skill.created_at,
          skill.updated_at
        );
      return { success: true, data: skill };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getOrgSkill(skillId: string): IQueryResult<TOrgSkill> {
    try {
      const row = this.db.prepare('SELECT * FROM org_skills WHERE id = ?').get(skillId) as IOrgSkillRow | undefined;
      if (!row) {
        return { success: false, error: 'Organization skill not found' };
      }
      return { success: true, data: { ...row, resources: parseJson(row.resources, undefined) } };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  listOrgSkills(params: IListOrgSkillParams): IQueryResult<TOrgSkill[]> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM org_skills WHERE organization_id = ? ORDER BY updated_at DESC')
        .all(params.organization_id) as IOrgSkillRow[];
      return {
        success: true,
        data: rows.map((row) => ({ ...row, resources: parseJson(row.resources, undefined) })),
      };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  updateOrgSkill(
    skillId: string,
    updates: Partial<
      Pick<TOrgSkill, 'name' | 'description' | 'workflow_unit' | 'instructions' | 'resources' | 'version'>
    >
  ): IQueryResult<boolean> {
    try {
      const existing = this.getOrgSkill(skillId);
      if (!existing.success) {
        return { success: false, error: 'Organization skill not found' };
      }

      const now = Date.now();
      const setClauses: string[] = ['updated_at = ?'];
      const sqlParams: (string | number | null)[] = [now];

      if (updates.name !== undefined) {
        setClauses.push('name = ?');
        sqlParams.push(updates.name);
      }
      if (updates.description !== undefined) {
        setClauses.push('description = ?');
        sqlParams.push(updates.description ?? null);
      }
      if (updates.workflow_unit !== undefined) {
        setClauses.push('workflow_unit = ?');
        sqlParams.push(updates.workflow_unit);
      }
      if (updates.instructions !== undefined) {
        setClauses.push('instructions = ?');
        sqlParams.push(updates.instructions ?? null);
      }
      if (updates.resources !== undefined) {
        setClauses.push('resources = ?');
        sqlParams.push(toJson(updates.resources));
      }
      if (updates.version !== undefined) {
        setClauses.push('version = ?');
        sqlParams.push(updates.version);
      }

      sqlParams.push(skillId);
      this.db.prepare(`UPDATE org_skills SET ${setClauses.join(', ')} WHERE id = ?`).run(...sqlParams);
      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  deleteOrgSkill(skillId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM org_skills WHERE id = ?').run(skillId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  createOrgGenomePatch(patch: TOrgGenomePatch): IQueryResult<TOrgGenomePatch> {
    try {
      this.db
        .prepare(
          `
          INSERT INTO org_genome_patches (
            id, organization_id, mutation_target, based_on, proposal, status,
            offline_eval_result, canary_result, decision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          patch.id,
          patch.organization_id,
          patch.mutation_target,
          toJson(patch.based_on),
          toJson(patch.proposal),
          patch.status,
          patch.offline_eval_result !== undefined ? toJson(patch.offline_eval_result) : null,
          patch.canary_result !== undefined ? toJson(patch.canary_result) : null,
          patch.decision !== undefined ? toJson(patch.decision) : null,
          patch.created_at,
          patch.updated_at
        );

      return { success: true, data: patch };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getOrgGenomePatch(patchId: string): IQueryResult<TOrgGenomePatch> {
    try {
      const row = this.db.prepare('SELECT * FROM org_genome_patches WHERE id = ?').get(patchId) as
        | IOrgGenomePatchRow
        | undefined;
      if (!row) {
        return { success: false, error: 'Organization genome patch not found' };
      }
      return {
        success: true,
        data: {
          ...row,
          based_on: parseJson(row.based_on, []),
          proposal: parseJson(row.proposal, {}),
          offline_eval_result: parseJson(row.offline_eval_result, undefined),
          canary_result: parseJson(row.canary_result, undefined),
          decision: parseJson(row.decision, undefined),
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  listOrgGenomePatches(params: IListOrgGenomePatchParams): IQueryResult<TOrgGenomePatch[]> {
    try {
      const where: string[] = ['organization_id = ?'];
      const sqlParams: string[] = [params.organization_id];
      if (params.status) {
        where.push('status = ?');
        sqlParams.push(params.status);
      }

      const rows = this.db
        .prepare(`SELECT * FROM org_genome_patches WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`)
        .all(...sqlParams) as IOrgGenomePatchRow[];

      return {
        success: true,
        data: rows.map((row) => ({
          ...row,
          based_on: parseJson(row.based_on, []),
          proposal: parseJson(row.proposal, {}),
          offline_eval_result: parseJson(row.offline_eval_result, undefined),
          canary_result: parseJson(row.canary_result, undefined),
          decision: parseJson(row.decision, undefined),
        })),
      };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  updateOrgGenomePatch(
    patchId: string,
    updates: Partial<
      Pick<
        TOrgGenomePatch,
        'mutation_target' | 'based_on' | 'proposal' | 'status' | 'offline_eval_result' | 'canary_result' | 'decision'
      >
    >
  ): IQueryResult<boolean> {
    try {
      const existing = this.getOrgGenomePatch(patchId);
      if (!existing.success) {
        return { success: false, error: 'Organization genome patch not found' };
      }

      const now = Date.now();
      const setClauses: string[] = ['updated_at = ?'];
      const sqlParams: (string | number | null)[] = [now];

      if (updates.mutation_target !== undefined) {
        setClauses.push('mutation_target = ?');
        sqlParams.push(updates.mutation_target);
      }
      if (updates.based_on !== undefined) {
        setClauses.push('based_on = ?');
        sqlParams.push(toJson(updates.based_on));
      }
      if (updates.proposal !== undefined) {
        setClauses.push('proposal = ?');
        sqlParams.push(toJson(updates.proposal));
      }
      if (updates.status !== undefined) {
        setClauses.push('status = ?');
        sqlParams.push(updates.status);
      }
      if (updates.offline_eval_result !== undefined) {
        setClauses.push('offline_eval_result = ?');
        sqlParams.push(toJson(updates.offline_eval_result));
      }
      if (updates.canary_result !== undefined) {
        setClauses.push('canary_result = ?');
        sqlParams.push(toJson(updates.canary_result));
      }
      if (updates.decision !== undefined) {
        setClauses.push('decision = ?');
        sqlParams.push(toJson(updates.decision));
      }

      sqlParams.push(patchId);
      this.db.prepare(`UPDATE org_genome_patches SET ${setClauses.join(', ')} WHERE id = ?`).run(...sqlParams);
      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  deleteOrgGenomePatch(patchId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM org_genome_patches WHERE id = ?').run(patchId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  createOrgAuditLog(log: TOrgGovernanceAuditLogRecord): IQueryResult<TOrgGovernanceAuditLogRecord> {
    try {
      this.db
        .prepare(
          `
          INSERT INTO org_audit_logs (id, organization_id, action, actor, target_type, target_id, detail, at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .run(
          log.id,
          log.organization_id,
          log.action,
          log.actor,
          log.target_type ?? null,
          log.target_id ?? null,
          log.detail ?? null,
          log.at
        );
      return { success: true, data: log };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getOrgAuditLog(logId: string): IQueryResult<TOrgGovernanceAuditLogRecord> {
    try {
      const row = this.db.prepare('SELECT * FROM org_audit_logs WHERE id = ?').get(logId) as
        | TOrgGovernanceAuditLogRecord
        | undefined;
      if (!row) {
        return { success: false, error: 'Organization audit log not found' };
      }
      return { success: true, data: row };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  listOrgAuditLogs(params: {
    organization_id: string;
    target_type?: string;
    target_id?: string;
    action?: string;
    limit?: number;
  }): IQueryResult<TOrgGovernanceAuditLogRecord[]> {
    try {
      const where: string[] = ['organization_id = ?'];
      const sqlParams: Array<string | number> = [params.organization_id];

      if (params.target_type) {
        where.push('target_type = ?');
        sqlParams.push(params.target_type);
      }
      if (params.target_id) {
        where.push('target_id = ?');
        sqlParams.push(params.target_id);
      }
      if (params.action) {
        where.push('action = ?');
        sqlParams.push(params.action);
      }

      const limit = params.limit && params.limit > 0 ? params.limit : 100;
      sqlParams.push(limit);

      const rows = this.db
        .prepare(`SELECT * FROM org_audit_logs WHERE ${where.join(' AND ')} ORDER BY at DESC LIMIT ?`)
        .all(...sqlParams) as TOrgGovernanceAuditLogRecord[];
      return { success: true, data: rows };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  updateOrgAuditLog(
    logId: string,
    updates: Partial<Pick<TOrgGovernanceAuditLog, 'detail' | 'target_type' | 'target_id'>>
  ): IQueryResult<boolean> {
    try {
      const existing = this.getOrgAuditLog(logId);
      if (!existing.success) {
        return { success: false, error: 'Organization audit log not found' };
      }

      const setClauses: string[] = [];
      const sqlParams: Array<string | null> = [];
      if (updates.detail !== undefined) {
        setClauses.push('detail = ?');
        sqlParams.push(updates.detail ?? null);
      }
      if (updates.target_type !== undefined) {
        setClauses.push('target_type = ?');
        sqlParams.push(updates.target_type ?? null);
      }
      if (updates.target_id !== undefined) {
        setClauses.push('target_id = ?');
        sqlParams.push(updates.target_id ?? null);
      }

      if (setClauses.length === 0) {
        return { success: true, data: true };
      }

      sqlParams.push(logId);
      this.db.prepare(`UPDATE org_audit_logs SET ${setClauses.join(', ')} WHERE id = ?`).run(...sqlParams);
      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  deleteOrgAuditLog(logId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM org_audit_logs WHERE id = ?').run(logId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * ==================
   * ==================
   * Project operations
   * Project 操作
   * ==================
   */

  /**
   * Create a new project
   */
  createProject(project: TProject): IQueryResult<TProject> {
    try {
      const row = projectToRow(project);
      const stmt = this.db.prepare(`
        INSERT INTO projects (id, name, description, workspace, conversation_id, user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        row.id,
        row.name,
        row.description,
        row.workspace,
        row.conversation_id,
        row.user_id,
        row.created_at,
        row.updated_at
      );
      return { success: true, data: project };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get project by ID
   */
  getProject(projectId: string): IQueryResult<TProject> {
    try {
      const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as IProjectRow | undefined;
      if (!row) {
        return { success: false, error: 'Project not found' };
      }
      return { success: true, data: rowToProject(row) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all projects for a user with task count
   */
  getUserProjects(userId?: string): IQueryResult<TProjectWithCount[]> {
    try {
      const finalUserId = userId || this.defaultUserId;
      const rows = this.db
        .prepare(
          `
          SELECT p.*, COUNT(t.id) as task_count
          FROM projects p
          LEFT JOIN tasks t ON t.project_id = p.id
          WHERE p.user_id = ?
          GROUP BY p.id
          ORDER BY p.updated_at DESC
        `
        )
        .all(finalUserId) as Array<IProjectRow & { task_count: number }>;

      const projects: TProjectWithCount[] = rows.map((row) => ({
        ...rowToProject(row),
        task_count: row.task_count,
      }));

      return { success: true, data: projects };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Update project
   */
  updateProject(
    projectId: string,
    updates: Partial<Pick<TProject, 'name' | 'description' | 'workspace' | 'conversation_id'>>
  ): IQueryResult<boolean> {
    try {
      const existing = this.getProject(projectId);
      if (!existing.success || !existing.data) {
        return { success: false, error: 'Project not found' };
      }

      const now = Date.now();
      const setClauses: string[] = ['updated_at = ?'];
      const params: (string | number | null)[] = [now];

      if (updates.name !== undefined) {
        setClauses.push('name = ?');
        params.push(updates.name);
      }
      if (updates.description !== undefined) {
        setClauses.push('description = ?');
        params.push(updates.description ?? null);
      }
      if (updates.workspace !== undefined) {
        setClauses.push('workspace = ?');
        params.push(updates.workspace);
      }
      if (updates.conversation_id !== undefined) {
        setClauses.push('conversation_id = ?');
        params.push(updates.conversation_id ?? null);
      }

      params.push(projectId);
      const stmt = this.db.prepare(`UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`);
      stmt.run(...params);

      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete project (cascades to tasks, conversations get task_id cleared)
   */
  deleteProject(projectId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * ==================
   * Task operations
   * Task 操作 (work items within a Project)
   * ==================
   */

  /**
   * Create a new task within a project
   */
  createTask(task: TTask): IQueryResult<TTask> {
    try {
      const row = taskToRow(task);
      const stmt = this.db.prepare(`
        INSERT INTO tasks (id, project_id, name, description, status, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        row.id,
        row.project_id,
        row.name,
        row.description,
        row.status,
        row.sort_order,
        row.created_at,
        row.updated_at
      );
      return { success: true, data: task };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): IQueryResult<TTask> {
    try {
      const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as ITaskRow | undefined;
      if (!row) {
        return { success: false, error: 'Task not found' };
      }
      return { success: true, data: rowToTask(row) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all tasks for a project with conversation count
   */
  getProjectTasks(projectId: string): IQueryResult<TTaskWithCount[]> {
    try {
      const rows = this.db
        .prepare(
          `
          SELECT t.*, COUNT(c.id) as conversation_count
          FROM tasks t
          LEFT JOIN conversations c ON c.task_id = t.id
          WHERE t.project_id = ?
          GROUP BY t.id
          ORDER BY t.sort_order ASC, t.updated_at DESC
        `
        )
        .all(projectId) as Array<ITaskRow & { conversation_count: number }>;

      const tasks: TTaskWithCount[] = rows.map((row) => ({
        ...rowToTask(row),
        conversation_count: row.conversation_count,
      }));

      return { success: true, data: tasks };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Update task
   */
  updateTask(
    taskId: string,
    updates: Partial<Pick<TTask, 'name' | 'description' | 'status' | 'sort_order'>>
  ): IQueryResult<boolean> {
    try {
      const existing = this.getTask(taskId);
      if (!existing.success || !existing.data) {
        return { success: false, error: 'Task not found' };
      }

      const now = Date.now();
      const setClauses: string[] = ['updated_at = ?'];
      const params: (string | number | null)[] = [now];

      if (updates.name !== undefined) {
        setClauses.push('name = ?');
        params.push(updates.name);
      }
      if (updates.description !== undefined) {
        setClauses.push('description = ?');
        params.push(updates.description ?? null);
      }
      if (updates.status !== undefined) {
        setClauses.push('status = ?');
        params.push(updates.status);
      }
      if (updates.sort_order !== undefined) {
        setClauses.push('sort_order = ?');
        params.push(updates.sort_order);
      }

      params.push(taskId);
      const stmt = this.db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`);
      stmt.run(...params);

      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete task (conversations get task_id cleared via ON DELETE SET NULL)
   */
  deleteTask(taskId: string): IQueryResult<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
      return { success: true, data: result.changes > 0 };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get conversations by task ID
   */
  getTaskConversations(taskId: string): IQueryResult<TChatConversation[]> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM conversations WHERE task_id = ? ORDER BY updated_at DESC')
        .all(taskId) as IConversationRow[];
      return { success: true, data: rows.map(rowToConversation) };
    } catch (error: any) {
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Associate conversation with task
   */
  associateConversationWithTask(conversationId: string, taskId: string | null): IQueryResult<boolean> {
    try {
      const now = Date.now();
      this.db
        .prepare('UPDATE conversations SET task_id = ?, updated_at = ? WHERE id = ?')
        .run(taskId, now, conversationId);
      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Vacuum database to reclaim space
   */
  vacuum(): void {
    this.db.exec('VACUUM');
    console.log('[Database] Vacuum completed');
  }
}

// Export singleton instance
let dbInstance: AionUIDatabase | null = null;

export function getDatabase(): AionUIDatabase {
  if (!dbInstance) {
    dbInstance = new AionUIDatabase();
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
