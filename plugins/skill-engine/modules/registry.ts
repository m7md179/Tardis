import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { skills } from './schema';
import type { Skill, SkillCategory, XPResult } from './types';
import { generateId, calculateLevel, calculateXP } from './utils';

export class SkillRegistry {
  constructor(private db: BunSQLiteDatabase) {}

  async addSkill(name: string, category: SkillCategory, subcategory?: string): Promise<Skill> {
    const now = new Date();
    const id = generateId();

    await this.db.insert(skills).values({
      id,
      name: name.toLowerCase().trim(),
      category,
      subcategory: subcategory ?? null,
      level: 1,
      xp: 0,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      name: name.toLowerCase().trim(),
      category,
      subcategory: subcategory ?? null,
      level: 1,
      xp: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  async removeSkill(skillId: string): Promise<void> {
    await this.db.delete(skills).where(eq(skills.id, skillId));
  }

  async getSkillById(id: string): Promise<Skill | null> {
    const rows = await this.db.select().from(skills).where(eq(skills.id, id));
    return (rows[0] as Skill | undefined) ?? null;
  }

  async getSkillByName(name: string): Promise<Skill | null> {
    const rows = await this.db.select().from(skills).where(eq(skills.name, name.toLowerCase().trim()));
    return (rows[0] as Skill | undefined) ?? null;
  }

  async listSkills(category?: SkillCategory): Promise<Skill[]> {
    if (category) {
      return this.db.select().from(skills).where(eq(skills.category, category)) as Promise<Skill[]>;
    }
    return this.db.select().from(skills) as Promise<Skill[]>;
  }

  async addXP(skillId: string, difficulty: number, score: number): Promise<XPResult> {
    const skill = await this.getSkillById(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);

    const xpEarned = calculateXP(difficulty, score);
    const newXP = skill.xp + xpEarned;
    const previousLevel = skill.level;
    const newLevel = calculateLevel(newXP);

    await this.db
      .update(skills)
      .set({ xp: newXP, level: newLevel, updatedAt: new Date() })
      .where(eq(skills.id, skillId));

    return {
      xpEarned,
      newXP,
      newLevel,
      previousLevel,
      leveledUp: newLevel > previousLevel,
    };
  }
}
