import { Markup } from 'telegraf';

export interface TaskOption {
  id: string;
  content: string;
  timeWindow?: {
    start: string;
    end: string;
  };
}

/**
 * Create keyboard for task selection
 */
export function createTaskKeyboard(tasks: TaskOption[]) {
  const buttons = tasks.map((task, index) => {
    let label = `${index + 1}. ${task.content}`;
    if (task.timeWindow) {
      label += ` [${task.timeWindow.start}-${task.timeWindow.end}]`;
    }
    return [Markup.button.callback(label, `select_task_${task.id}`)];
  });

  return Markup.inlineKeyboard(buttons);
}

/**
 * Create keyboard for session selection
 */
export function createSessionKeyboard(sessions: any[]) {
  const buttons = sessions.map((session, index) => {
    const startTime = new Date(session.startTime).toLocaleTimeString();
    const label = `${index + 1}. ${session.taskName} (${startTime})`;
    return [Markup.button.callback(label, `select_session_${session.id}`)];
  });

  return Markup.inlineKeyboard(buttons);
}

/**
 * Create confirmation keyboard
 */
export function createConfirmKeyboard(action: string, data: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✓ Yes', `confirm_${action}_${data}`),
      Markup.button.callback('✗ No', `cancel_${action}`),
    ],
  ]);
}
