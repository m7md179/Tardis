/**
 * Generate a UUID for database records
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Calculate level from XP using diminishing returns formula
 * level = floor(sqrt(xp / 100))
 * Level 1 = 100 XP, Level 10 = 10,000 XP, Level 50 = 250,000 XP
 */
export function calculateLevel(xp: number): number {
  if (xp <= 0) return 1;
  return Math.max(1, Math.floor(Math.sqrt(xp / 100)));
}

/**
 * Calculate XP needed for a specific level
 */
export function xpForLevel(level: number): number {
  return level * level * 100;
}

/**
 * Calculate XP earned from a training session
 * base_xp * difficulty_multiplier * score
 */
export function calculateXP(difficulty: number, score: number): number {
  const baseXP = 100;
  const difficultyMultiplier = difficulty / 5;
  return Math.round(baseXP * difficultyMultiplier * score);
}

/**
 * Fuzzy match a query against a skill name
 * Returns a score: 0 = no match, higher = better match
 */
export function fuzzyMatchSkill(query: string, skillName: string): number {
  const q = query.toLowerCase().trim();
  const s = skillName.toLowerCase().trim();

  // Exact match
  if (q === s) return 100;

  // Prefix match
  if (s.startsWith(q)) return 80;

  // Contains match
  if (s.includes(q)) return 60;

  // Word overlap
  const queryWords = q.split(/\s+/);
  const skillWords = s.split(/\s+/);
  let matchCount = 0;
  for (const qw of queryWords) {
    if (skillWords.some((sw) => sw.includes(qw) || qw.includes(sw))) {
      matchCount++;
    }
  }
  const overlapRatio = matchCount / queryWords.length;
  if (overlapRatio >= 0.5) return Math.round(40 * overlapRatio);

  return 0;
}

/**
 * Find the best matching skill from a list
 */
export function findBestMatch<T extends { name: string }>(
  query: string,
  items: T[],
): T | null {
  let bestScore = 0;
  let bestItem: T | null = null;

  for (const item of items) {
    const score = fuzzyMatchSkill(query, item.name);
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  return bestScore > 0 ? bestItem : null;
}

/**
 * Format a level with a progress bar
 */
export function formatLevel(level: number, xp: number): string {
  const currentLevelXP = xpForLevel(level);
  const nextLevelXP = xpForLevel(level + 1);
  const progress = Math.min(1, (xp - currentLevelXP) / (nextLevelXP - currentLevelXP));
  const filled = Math.round(progress * 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return `Lv.${level} [${bar}] ${Math.round(progress * 100)}%`;
}
