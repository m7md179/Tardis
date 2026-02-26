import type { MemoryEntry, MemoryType } from '@tardis/shared';
import type { MemoryStore } from './memory-store.js';

// ─── Scoring constants ───

const KEYWORD_KEY_SCORE = 10;
const KEYWORD_VALUE_SCORE = 5;
const MAX_RECENCY_BONUS = 5;
const RECENCY_DECAY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TYPE_PRIORITY: Record<MemoryType, number> = {
  user_fact: 2,
  preference: 2,
  project: 1,
  plugin: 0,
};

// Rough estimate: ~4 chars per token
const CHARS_PER_TOKEN = 4;

interface ScoredMemory {
  memory: MemoryEntry;
  score: number;
  keywordHits: number;
}

export class MemoryRetriever {
  constructor(
    private readonly store: MemoryStore,
    private readonly tokenBudget: number = 2000
  ) {}

  /**
   * Given a user message, retrieve the most relevant memories
   * that fit within the token budget.
   */
  async getRelevant(userMessage: string): Promise<MemoryEntry[]> {
    const allMemories = await this.store.getAll(500);
    if (allMemories.length === 0) return [];

    const keywords = this.extractKeywords(userMessage);
    const now = Date.now();

    const scored: ScoredMemory[] = allMemories.map((memory) => {
      const { score, keywordHits } = this.scoreMemory(memory, keywords, now);
      return { memory, score, keywordHits };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Require at least one keyword match — recency/type alone isn't enough
    const relevant = scored.filter((s) => s.keywordHits > 0);

    // If no relevant matches, return nothing (don't waste token budget on noise)
    if (relevant.length === 0) return [];

    // Pack within token budget
    const selected: MemoryEntry[] = [];
    let usedTokens = 0;

    for (const { memory } of relevant) {
      const entryTokens = this.estimateTokens(memory);
      if (usedTokens + entryTokens > this.tokenBudget) break;
      selected.push(memory);
      usedTokens += entryTokens;
    }

    // Touch accessed timestamps in background (fire-and-forget)
    for (const mem of selected) {
      this.store.touchAccessed(mem.id).catch(() => {});
    }

    return selected;
  }

  private scoreMemory(
    memory: MemoryEntry,
    keywords: string[],
    now: number
  ): { score: number; keywordHits: number } {
    let score = 0;
    let keywordHits = 0;

    // 1. Keyword matching
    const keyLower = memory.key.toLowerCase();
    const valueLower = memory.value.toLowerCase();
    for (const kw of keywords) {
      if (keyLower.includes(kw)) {
        score += KEYWORD_KEY_SCORE;
        keywordHits++;
      }
      if (valueLower.includes(kw)) {
        score += KEYWORD_VALUE_SCORE;
        keywordHits++;
      }
    }

    // 2. Recency bonus (0-5 points, linear decay over 7 days)
    const lastTouch = memory.accessedAt ?? memory.updatedAt;
    const age = now - lastTouch;
    const recencyBonus = Math.max(0, MAX_RECENCY_BONUS * (1 - age / RECENCY_DECAY_MS));
    score += recencyBonus;

    // 3. Type priority (0-2 points)
    score += TYPE_PRIORITY[memory.type] ?? 0;

    return { score, keywordHits };
  }

  private extractKeywords(message: string): string[] {
    // Split on non-alphanumeric, lowercase, filter short/stop words
    const words = message
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);

    const stopWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
      'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'from',
      'they', 'been', 'said', 'each', 'which', 'their', 'will', 'other',
      'about', 'many', 'then', 'them', 'these', 'some', 'would', 'make',
      'like', 'time', 'just', 'know', 'take', 'come', 'could', 'than',
      'look', 'only', 'into', 'year', 'your', 'good', 'give', 'also',
      'back', 'after', 'use', 'two', 'how', 'what', 'when', 'where',
      'who', 'why', 'did', 'does', 'this', 'that', 'with',
    ]);

    return [...new Set(words.filter((w) => !stopWords.has(w)))];
  }

  private estimateTokens(memory: MemoryEntry): number {
    // "- key: value\n" format as injected in system prompt
    const text = `- ${memory.key}: ${memory.value}\n`;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }
}
