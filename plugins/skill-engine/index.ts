import type { TardisPlugin, PluginAPI, Session } from '@tardis/shared';
import { type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { SkillRegistry } from './modules/registry';
import { TrainingManager } from './modules/training';
import { DifficultyEngine } from './modules/difficulty';
import { AnalyticsEngine } from './modules/analytics';
import { findBestMatch, formatLevel } from './modules/utils';
import type { SkillCategory, TrainingType } from './modules/types';

let registry: SkillRegistry;
let training: TrainingManager;
let difficulty: DifficultyEngine;
let analytics: AnalyticsEngine;
let pluginApi: PluginAPI;

const plugin: TardisPlugin = {
  name: 'skill-engine',
  version: '1.0.0',

  async onActivate(api: PluginAPI) {
    pluginApi = api;
    const db = api.db.drizzle() as BunSQLiteDatabase;

    registry = new SkillRegistry(db);
    training = new TrainingManager(db);

    const targetRate = (api.config.get<number>('targetSuccessRate') ?? 0.85);
    difficulty = new DifficultyEngine(db, training, targetRate);
    analytics = new AnalyticsEngine(db, registry, training, difficulty);

    api.logger.info('Skill Engine activated');
  },

  async onSessionStop(session: Session, api: PluginAPI) {
    // Check if the stopped session matches a tracked skill
    const allSkills = await registry.listSkills();
    const match = findBestMatch(session.taskName, allSkills);

    if (match) {
      const active = await training.getActiveTraining();
      if (active && active.skillId === match.id) {
        // There's an active training session for this skill — prompt user
        await api.notifications.send(
          `Training session for "${match.name}" is still active. ` +
          `Complete it with: plugin skill-engine complete-training <score>`,
        );
      }
    }
  },

  commands: {
    async 'add-skill'(args: string[], api: PluginAPI) {
      if (args.length === 0) {
        await api.notifications.send('Usage: add-skill <name> [category]\nCategories: tech, non-tech');
        return;
      }

      const name = args[0]!;
      const category = (args[1] as SkillCategory) || 'tech';

      if (category !== 'tech' && category !== 'non-tech') {
        await api.notifications.send('Category must be "tech" or "non-tech"');
        return;
      }

      // Check if skill already exists
      const existing = await registry.getSkillByName(name);
      if (existing) {
        await api.notifications.send(`Skill "${name}" already exists (${formatLevel(existing.level, existing.xp)})`);
        return;
      }

      const skill = await registry.addSkill(name, category, args[2]);
      await api.notifications.send(`Added skill: ${skill.name} [${skill.category}] — ${formatLevel(1, 0)}`);
    },

    async 'remove-skill'(args: string[], api: PluginAPI) {
      if (args.length === 0) {
        await api.notifications.send('Usage: remove-skill <name>');
        return;
      }

      const allSkills = await registry.listSkills();
      const match = findBestMatch(args[0]!, allSkills);

      if (!match) {
        await api.notifications.send(`No skill found matching "${args[0]}"`);
        return;
      }

      await registry.removeSkill(match.id);
      await api.notifications.send(`Removed skill: ${match.name}`);
    },

    async skills(_args: string[], api: PluginAPI) {
      const allSkills = await registry.listSkills();

      if (allSkills.length === 0) {
        await api.notifications.send('No skills tracked yet. Add one with: add-skill <name> [category]');
        return;
      }

      const lines = ['Skills:'];
      const techSkills = allSkills.filter((s) => s.category === 'tech');
      const nonTechSkills = allSkills.filter((s) => s.category === 'non-tech');

      if (techSkills.length > 0) {
        lines.push('\nTech:');
        for (const s of techSkills) {
          lines.push(`  ${s.name} — ${formatLevel(s.level, s.xp)}`);
        }
      }

      if (nonTechSkills.length > 0) {
        lines.push('\nNon-Tech:');
        for (const s of nonTechSkills) {
          lines.push(`  ${s.name} — ${formatLevel(s.level, s.xp)}`);
        }
      }

      await api.notifications.send(lines.join('\n'));
    },

    async train(args: string[], api: PluginAPI) {
      if (args.length === 0) {
        await api.notifications.send('Usage: train <skill> [type]\nTypes: practice, quiz, challenge, review');
        return;
      }

      // Check for existing active training
      const active = await training.getActiveTraining();
      if (active) {
        const skill = await registry.getSkillById(active.skillId);
        await api.notifications.send(
          `Training already in progress for "${skill?.name ?? 'unknown'}" (difficulty: ${active.difficulty}). ` +
          `Complete it first with: complete-training <score>`,
        );
        return;
      }

      const allSkills = await registry.listSkills();
      const match = findBestMatch(args[0]!, allSkills);

      if (!match) {
        await api.notifications.send(
          `No skill found matching "${args[0]}". Available: ${allSkills.map((s) => s.name).join(', ') || 'none'}`,
        );
        return;
      }

      const type = (args[1] as TrainingType) || 'practice';
      const recommended = await difficulty.getRecommendedDifficulty(match.id);

      const session = await training.startTraining(match.id, type, recommended);
      await api.notifications.send(
        `Training started: ${match.name}\n` +
        `Type: ${type} | Difficulty: ${session.difficulty}/10\n` +
        `When done, run: complete-training <score (0-100)>`,
      );
    },

    async 'complete-training'(args: string[], api: PluginAPI) {
      const active = await training.getActiveTraining();
      if (!active) {
        await api.notifications.send('No active training session. Start one with: train <skill>');
        return;
      }

      if (args.length === 0) {
        await api.notifications.send('Usage: complete-training <score>\nScore: 0-100 (percentage)');
        return;
      }

      const scorePercent = parseInt(args[0]!, 10);
      if (isNaN(scorePercent) || scorePercent < 0 || scorePercent > 100) {
        await api.notifications.send('Score must be a number between 0 and 100');
        return;
      }

      const score = scorePercent / 100;
      const topic = args.slice(1).join(' ') || 'general';

      // Complete the training session
      const completed = await training.completeTraining(active.id, score);

      // Award XP
      const xpResult = await registry.addXP(active.skillId, active.difficulty, score);

      // Check for weak areas
      const weakArea = await difficulty.detectWeakAreas(active.skillId, topic, score);

      const skill = await registry.getSkillById(active.skillId);
      const lines = [
        `Training complete: ${skill?.name ?? 'unknown'}`,
        `Score: ${scorePercent}% | Difficulty: ${completed.difficulty}/10`,
        `XP earned: +${xpResult.xpEarned} (total: ${xpResult.newXP})`,
      ];

      if (xpResult.leveledUp) {
        lines.push(`LEVEL UP! ${xpResult.previousLevel} → ${xpResult.newLevel}`);
        if (api.config.get<boolean>('notifyOnLevelUp')) {
          // Extra celebration notification
        }
      }

      if (weakArea && api.config.get<boolean>('notifyOnWeakness')) {
        lines.push(`Weak area detected: ${weakArea.topic} (severity: ${weakArea.severity.toFixed(1)})`);
      }

      const performance = await difficulty.analyzePerformance(active.skillId);
      lines.push(`Success rate: ${(performance.successRate * 100).toFixed(0)}% | Next difficulty: ${performance.recommendedDifficulty}/10`);

      await api.notifications.send(lines.join('\n'));

      // Auto-create Todoist tasks for weak areas if enabled
      if (weakArea && api.config.get<boolean>('autoCreateTasks')) {
        try {
          await api.tasks.create(
            `Practice ${skill?.name}: ${weakArea.topic}`,
            `Weak area detected (severity: ${weakArea.severity.toFixed(1)})`,
            'tomorrow',
          );
        } catch {
          // Todoist may not be available
        }
      }
    },

    async progress(args: string[], api: PluginAPI) {
      if (args.length === 0) {
        // Show overall progress
        const stats = await analytics.getOverallStats();

        if (stats.totalSkills === 0) {
          await api.notifications.send('No skills tracked yet. Add one with: add-skill <name>');
          return;
        }

        const lines = [
          'Overall Progress:',
          `Skills: ${stats.totalSkills} | Sessions: ${stats.totalSessions}`,
          `Total XP: ${stats.totalXP} | Avg success: ${(stats.avgSuccessRate * 100).toFixed(0)}%`,
          `Streak: ${stats.currentStreak} day${stats.currentStreak !== 1 ? 's' : ''}`,
          '',
          ...stats.skillBreakdown.map(
            (s) => `  ${s.name} — Lv.${s.level} (${s.sessions} sessions)`,
          ),
        ];

        await api.notifications.send(lines.join('\n'));
        return;
      }

      const allSkills = await registry.listSkills();
      const match = findBestMatch(args[0]!, allSkills);

      if (!match) {
        await api.notifications.send(`No skill found matching "${args[0]}"`);
        return;
      }

      const report = await analytics.getProgress(match.id);
      if (!report) {
        await api.notifications.send('Could not generate progress report');
        return;
      }

      const lines = [
        `Progress: ${report.skill.name}`,
        formatLevel(report.skill.level, report.skill.xp),
        `Success rate: ${(report.performance.successRate * 100).toFixed(0)}% (${report.performance.trend})`,
        `Sessions: ${report.performance.sessionCount} | Streak: ${report.streak} day${report.streak !== 1 ? 's' : ''}`,
        `Next difficulty: ${report.performance.recommendedDifficulty}/10`,
      ];

      if (report.weakAreas.length > 0) {
        lines.push('', 'Weak areas:');
        for (const wa of report.weakAreas) {
          lines.push(`  ${wa.topic} (severity: ${wa.severity.toFixed(1)})`);
        }
      }

      if (report.recentSessions.length > 0) {
        lines.push('', 'Recent sessions:');
        for (const s of report.recentSessions.slice(0, 5)) {
          const scoreStr = s.score !== null ? `${(s.score * 100).toFixed(0)}%` : 'in progress';
          lines.push(`  ${s.type} d${s.difficulty} — ${scoreStr}`);
        }
      }

      await api.notifications.send(lines.join('\n'));
    },

    async 'weak-areas'(args: string[], api: PluginAPI) {
      const allSkills = await registry.listSkills();
      let skillId: string | undefined;

      if (args.length > 0) {
        const match = findBestMatch(args[0]!, allSkills);
        if (!match) {
          await api.notifications.send(`No skill found matching "${args[0]}"`);
          return;
        }
        skillId = match.id;
      }

      const areas = await difficulty.getWeakAreas(skillId);

      if (areas.length === 0) {
        await api.notifications.send('No weak areas detected. Keep training!');
        return;
      }

      const lines = ['Weak Areas:'];
      for (const wa of areas) {
        const skill = allSkills.find((s) => s.id === wa.skillId);
        lines.push(`  ${skill?.name ?? '?'}: ${wa.topic} (severity: ${wa.severity.toFixed(1)})`);
      }

      await api.notifications.send(lines.join('\n'));
    },

    async stats(args: string[], api: PluginAPI) {
      const period = args[0] || 'weekly';
      let days: number;

      switch (period) {
        case 'daily':
          days = 1;
          break;
        case 'weekly':
          days = 7;
          break;
        case 'monthly':
          days = 30;
          break;
        default:
          days = 7;
      }

      const stats = await analytics.getOverallStats(days);

      const lines = [
        `Stats (${period}):`,
        `Skills: ${stats.totalSkills} | Sessions: ${stats.totalSessions}`,
        `Total XP: ${stats.totalXP}`,
        `Avg success: ${(stats.avgSuccessRate * 100).toFixed(0)}%`,
        `Streak: ${stats.currentStreak} day${stats.currentStreak !== 1 ? 's' : ''}`,
      ];

      if (stats.skillBreakdown.length > 0) {
        lines.push('', 'Breakdown:');
        for (const s of stats.skillBreakdown) {
          lines.push(`  ${s.name} — Lv.${s.level} (${s.sessions} sessions this period)`);
        }
      }

      await api.notifications.send(lines.join('\n'));
    },

    async calibrate(args: string[], api: PluginAPI) {
      if (args.length === 0) {
        const rate = difficulty.getTargetRate();
        await api.notifications.send(
          `Current target success rate: ${(rate * 100).toFixed(0)}%\n` +
          `Set with: calibrate <target (50-95)>`,
        );
        return;
      }

      const target = parseInt(args[0]!, 10);
      if (isNaN(target) || target < 50 || target > 95) {
        await api.notifications.send('Target must be between 50 and 95');
        return;
      }

      difficulty.setTargetRate(target / 100);
      await api.config.set('targetSuccessRate', target / 100);
      await api.notifications.send(`Target success rate set to ${target}%`);
    },

    async config(args: string[], api: PluginAPI) {
      if (args.length === 0) {
        const all = api.config.getAll();
        const lines = ['Skill Engine Config:'];
        for (const [key, value] of Object.entries(all)) {
          if (key === 'enabled') continue;
          lines.push(`  ${key}: ${JSON.stringify(value)}`);
        }
        await api.notifications.send(lines.join('\n'));
        return;
      }

      if (args.length === 1) {
        const value = api.config.get(args[0]!);
        await api.notifications.send(`${args[0]}: ${JSON.stringify(value)}`);
        return;
      }

      const key = args[0]!;
      let value: unknown = args[1]!;

      // Parse boolean/number values
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (!isNaN(Number(value))) value = Number(value);

      await api.config.set(key, value);
      await api.notifications.send(`Set ${key} = ${JSON.stringify(value)}`);
    },
  },
};

export default plugin;
