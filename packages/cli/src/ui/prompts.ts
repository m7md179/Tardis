import inquirer from 'inquirer';

/**
 * Confirm action with yes/no prompt
 */
export async function confirm(message: string, defaultValue = false): Promise<boolean> {
  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message,
      default: defaultValue,
    },
  ]);

  return confirmed;
}

/**
 * Get text input from user
 */
export async function input(message: string, defaultValue?: string): Promise<string> {
  const { value } = await inquirer.prompt<{ value: string }>([
    {
      type: 'input',
      name: 'value',
      message,
      default: defaultValue,
    },
  ]);

  return value;
}

/**
 * Get password input (hidden)
 */
export async function password(message: string): Promise<string> {
  const { value } = await inquirer.prompt<{ value: string }>([
    {
      type: 'password',
      name: 'value',
      message,
      mask: '*',
    },
  ]);

  return value;
}

/**
 * Select from a list of options
 */
export async function select<T extends string>(
  message: string,
  choices: T[],
  defaultValue?: T
): Promise<T> {
  const { selected } = await inquirer.prompt<{ selected: T }>([
    {
      type: 'list',
      name: 'selected',
      message,
      choices,
      default: defaultValue,
    },
  ]);

  return selected;
}

/**
 * Select multiple options from a list
 */
export async function multiSelect<T extends string>(
  message: string,
  choices: T[],
  defaultValues?: T[]
): Promise<T[]> {
  const { selected } = await inquirer.prompt<{ selected: T[] }>([
    {
      type: 'checkbox',
      name: 'selected',
      message,
      choices,
      default: defaultValues,
    },
  ]);

  return selected;
}

/**
 * Select from a list with descriptions
 */
export async function selectWithDescription<T extends string>(
  message: string,
  choices: Array<{ value: T; name: string; description?: string }>,
  defaultValue?: T
): Promise<T> {
  const { selected } = await inquirer.prompt<{ selected: T }>([
    {
      type: 'list',
      name: 'selected',
      message,
      choices: choices.map((c) => ({
        value: c.value,
        name: c.description ? `${c.name} - ${c.description}` : c.name,
      })),
      default: defaultValue,
    },
  ]);

  return selected;
}

/**
 * Task picker - select from a list of tasks
 */
export async function selectTask(
  message: string,
  tasks: Array<{ id: string; name: string; description?: string }>
): Promise<string> {
  if (tasks.length === 0) {
    throw new Error('No tasks available to select');
  }

  if (tasks.length === 1) {
    return tasks[0].id;
  }

  const { taskId } = await inquirer.prompt<{ taskId: string }>([
    {
      type: 'list',
      name: 'taskId',
      message,
      choices: tasks.map((task) => ({
        value: task.id,
        name: task.description ? `${task.name} - ${task.description}` : task.name,
      })),
    },
  ]);

  return taskId;
}

/**
 * Prompt for required input (keeps asking until non-empty)
 */
export async function requiredInput(message: string, errorMessage?: string): Promise<string> {
  while (true) {
    const value = await input(message);
    if (value.trim()) {
      return value.trim();
    }
    console.log(errorMessage || 'This field is required. Please enter a value.');
  }
}
