import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import type {
  NotificationPreferences,
  NotificationCategory,
  Channel,
  UpdatePreferencesDTO,
} from './communication.types.js';

interface PreferenceRow extends RowDataPacket {
  id: string;
  employee_id: string;
  category: NotificationCategory;
  preferred_channel: Channel;
  enabled: number;
  updated_at: string;
}

interface ChannelRow extends RowDataPacket {
  preferred_channel: Channel | null;
  enabled: number | null;
}

const CATEGORIES: NotificationCategory[] = [
  'onboarding','payroll','attendance','leave','performance','alerts','announcements'
];

class NotificationPreferencesService {
  async initializeDefaults(employeeId: string): Promise<void> {
    const values = CATEGORIES.map(cat => [randomUUID(), employeeId, cat, 'email', 1]);
    await db.query(
      `INSERT INTO notification_preferences (id, employee_id, category, preferred_channel, enabled)
       VALUES ${values.map(() => '(?, ?, ?, ?, ?)').join(', ')}
       ON DUPLICATE KEY UPDATE id = id`,
      values.flat()
    );
  }

  async getPreferences(employeeId: string): Promise<NotificationPreferences[]> {
    let [rows] = await db.execute<PreferenceRow[]>(
      'SELECT * FROM notification_preferences WHERE employee_id = ? ORDER BY category',
      [employeeId]
    );
    if (rows.length === 0) {
      await this.initializeDefaults(employeeId);
      [rows] = await db.execute<PreferenceRow[]>(
        'SELECT * FROM notification_preferences WHERE employee_id = ? ORDER BY category',
        [employeeId]
      );
    }
    return rows as NotificationPreferences[];
  }

  async updatePreference(employeeId: string, dto: UpdatePreferencesDTO): Promise<NotificationPreferences> {
    await db.execute(
      `INSERT INTO notification_preferences (id, employee_id, category, preferred_channel, enabled)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE preferred_channel = VALUES(preferred_channel), enabled = VALUES(enabled)`,
      [randomUUID(), employeeId, dto.category, dto.preferred_channel, dto.enabled ? 1 : 0]
    );
    const [rows] = await db.execute<PreferenceRow[]>(
      'SELECT * FROM notification_preferences WHERE employee_id = ? AND category = ?',
      [employeeId, dto.category]
    );
    return rows[0] as NotificationPreferences;
  }

  async getPreferredChannel(employeeId: string, category: string): Promise<Channel> {
    return (await this.getDeliveryPreference(employeeId, category)).channel;
  }

  async getDeliveryPreference(employeeId: string, category: string): Promise<{ channel: Channel; enabled: boolean }> {
    const [rows] = await db.execute<ChannelRow[]>(
      'SELECT preferred_channel, enabled FROM notification_preferences WHERE employee_id = ? AND category = ?',
      [employeeId, category]
    );
    if (!rows[0]) return { channel: 'email', enabled: true };
    return {
      channel: rows[0].preferred_channel ?? 'email',
      enabled: Boolean(rows[0].enabled),
    };
  }

  async initializeUserDefaults(userId: string): Promise<void> {
    const values = CATEGORIES.map(cat => [randomUUID(), userId, cat, 'email', 1]);
    await db.query(
      `INSERT INTO user_notification_preferences (id, user_id, category, preferred_channel, enabled)
       VALUES ${values.map(() => '(?, ?, ?, ?, ?)').join(', ')}
       ON DUPLICATE KEY UPDATE id = id`,
      values.flat()
    );
  }

  async getUserPreferences(userId: string): Promise<NotificationPreferences[]> {
    let [rows] = await db.execute<PreferenceRow[]>(
      `SELECT id, user_id AS employee_id, category, preferred_channel, enabled, updated_at
       FROM user_notification_preferences
       WHERE user_id = ?
       ORDER BY category`,
      [userId]
    );
    if (rows.length === 0) {
      await this.initializeUserDefaults(userId);
      [rows] = await db.execute<PreferenceRow[]>(
        `SELECT id, user_id AS employee_id, category, preferred_channel, enabled, updated_at
         FROM user_notification_preferences
         WHERE user_id = ?
         ORDER BY category`,
        [userId]
      );
    }
    return rows as NotificationPreferences[];
  }

  async updateUserPreference(userId: string, dto: UpdatePreferencesDTO): Promise<NotificationPreferences> {
    await db.execute(
      `INSERT INTO user_notification_preferences (id, user_id, category, preferred_channel, enabled)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE preferred_channel = VALUES(preferred_channel), enabled = VALUES(enabled)`,
      [randomUUID(), userId, dto.category, dto.preferred_channel, dto.enabled ? 1 : 0]
    );
    const [rows] = await db.execute<PreferenceRow[]>(
      `SELECT id, user_id AS employee_id, category, preferred_channel, enabled, updated_at
       FROM user_notification_preferences
       WHERE user_id = ? AND category = ?`,
      [userId, dto.category]
    );
    return rows[0] as NotificationPreferences;
  }
}

export const notificationPreferencesService = new NotificationPreferencesService();
