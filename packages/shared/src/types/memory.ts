export type MemoryType = 'user_fact' | 'project' | 'preference' | 'plugin';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  key: string;
  value: string;
  source: string;
  pluginName?: string;
  createdAt: number;
  updatedAt: number;
  accessedAt?: number;
}
