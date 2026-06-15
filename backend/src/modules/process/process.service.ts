import type {
  CreateProcessInput,
  ProcessFilters,
  ProcessMaster,
  UpdateProcessInput
} from "./process.types.js";
import { getProcessRepository } from "./process.repository.js";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";

export const processService = {
  async list(filters: ProcessFilters): Promise<ProcessMaster[]> {
    const repository = getProcessRepository();
    return repository.list(filters);
  },

  async getById(id: string): Promise<ProcessMaster> {
    const repository = getProcessRepository();

    const process = await repository.getById(id);

    if (!process) {
      throw new Error("Process not found");
    }

    return process;
  },

  async create(
    input: CreateProcessInput,
    userId: string
  ): Promise<ProcessMaster> {
    const repository = getProcessRepository();

    const existing = await repository.list({
      search: input.processCode,
      activeStatus: "all"
    });

    const duplicate = existing.find(
      (item) =>
        item.process_code.toLowerCase() === input.processCode.toLowerCase() ||
        item.process_name.trim().toLowerCase() === input.processName.trim().toLowerCase()
    );

    if (duplicate) {
      throw new Error("Process code or process name already exists");
    }

    return repository.create(input, userId);
  },

  async update(
    id: string,
    input: UpdateProcessInput,
    userId: string
  ): Promise<ProcessMaster> {
    const repository = getProcessRepository();

    const existing = await repository.getById(id);

    if (!existing) {
      throw new Error("Process not found");
    }

    return repository.update(id, input, userId);
  },

  async updateStatus(
    id: string,
    activeStatus: boolean,
    userId: string
  ): Promise<ProcessMaster> {
    const repository = getProcessRepository();

    const existing = await repository.getById(id);

    if (!existing) {
      throw new Error("Process not found");
    }

    return repository.updateStatus(id, activeStatus, userId);
  },

  async getConfiguration(processId: string): Promise<Record<string, unknown>> {
    await this.getById(processId);
    const [rows] = await db.execute<any[]>(
      `SELECT config_key, config_value
         FROM process_configuration
        WHERE process_id = ?
          AND active_status = 1`,
      [processId]
    );

    return rows.reduce<Record<string, unknown>>((configuration, row) => {
      let value = row.config_value;
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          // Keep legacy plain-text values readable.
        }
      }
      configuration[row.config_key] = value;
      return configuration;
    }, {});
  },

  async saveConfiguration(
    processId: string,
    values: Record<string, unknown>,
    userId: string
  ): Promise<Record<string, unknown>> {
    await this.getById(processId);
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      for (const [key, value] of Object.entries(values)) {
        await connection.execute(
          `INSERT INTO process_configuration
             (id, process_id, config_key, config_value, active_status, created_by, updated_by)
           VALUES (?, ?, ?, ?, 1, ?, ?)
           ON DUPLICATE KEY UPDATE
             config_value = VALUES(config_value),
             active_status = 1,
             updated_by = VALUES(updated_by),
             updated_at = CURRENT_TIMESTAMP`,
          [randomUUID(), processId, key, JSON.stringify(value ?? null), userId, userId]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return this.getConfiguration(processId);
  }
};
