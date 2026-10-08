import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import type { ExpenseCategory } from './expense.model.js';

class ExpenseCategoryService {
  async listCategories(includeInactive = false): Promise<ExpenseCategory[]> {
    const query = includeInactive
      ? 'SELECT * FROM expense_categories ORDER BY name'
      : 'SELECT * FROM expense_categories WHERE is_active = TRUE ORDER BY name';
    const [rows] = await db.query<RowDataPacket[]>(query);
    return rows.map(row => ({
      id: row.id, name: row.name, description: row.description,
      is_active: Boolean(row.is_active),
      created_at: new Date(row.created_at), updated_at: new Date(row.updated_at)
    }));
  }

  async getCategoryById(id: number): Promise<ExpenseCategory | null> {
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM expense_categories WHERE id = ?', [id]);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id, name: row.name, description: row.description,
      is_active: Boolean(row.is_active),
      created_at: new Date(row.created_at), updated_at: new Date(row.updated_at)
    };
  }

  async createCategory(name: string, description: string): Promise<ExpenseCategory> {
    const [result] = await db.query('INSERT INTO expense_categories (name, description) VALUES (?, ?)', [name, description]);
    const category = await this.getCategoryById((result as any).insertId);
    if (!category) throw new Error('Failed to create category');
    return category;
  }

  async updateCategory(
    id: number,
    updates: Partial<Pick<ExpenseCategory, 'name' | 'description' | 'is_active'>>
  ): Promise<ExpenseCategory> {
    const sets: string[] = [];
    const params: any[] = [];
    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
    if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description); }
    if (updates.is_active !== undefined) { sets.push('is_active = ?'); params.push(updates.is_active ? 1 : 0); }
    if (sets.length === 0) throw new Error('No updates provided');
    params.push(id);
    await db.query(`UPDATE expense_categories SET ${sets.join(', ')} WHERE id = ?`, params);
    const category = await this.getCategoryById(id);
    if (!category) throw new Error('Category not found after update');
    return category;
  }

  async deleteCategory(id: number): Promise<void> {
    await db.query('UPDATE expense_categories SET is_active = FALSE WHERE id = ?', [id]);
  }
}

export const expenseCategoryService = new ExpenseCategoryService();
