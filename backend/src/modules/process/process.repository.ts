import type { ProcessRepository } from "./process.types.js";
import { processRepositoryMySQL } from "./process.repository.mysql.js";

export function getProcessRepository(): ProcessRepository {
  return processRepositoryMySQL;
}
