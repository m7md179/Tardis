import {
  TodoistTask,
  TodoistTaskSchema,
  CreateTodoistTask,
  CreateTodoistTaskSchema,
} from '@tardis/shared';
import { ConfigStore } from '../storage/config-store';

/**
 * Todoist REST API v2 client
 * https://developer.todoist.com/rest/v2/
 */
export class TodoistClient {
  private apiToken: string;
  private readonly baseUrl = 'https://api.todoist.com/rest/v2';

  constructor(apiToken?: string) {
    if (apiToken) {
      this.apiToken = apiToken;
    } else {
      const configStore = new ConfigStore();
      const config = configStore.load();

      if (!config.todoist.apiToken) {
        throw new Error('Todoist API token not configured. Run: tardis setup');
      }

      this.apiToken = config.todoist.apiToken;
    }
  }

  /**
   * Get all active tasks
   */
  async getTasks(): Promise<TodoistTask[]> {
    const response = await fetch(`${this.baseUrl}/tasks`, {
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Todoist API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // Validate response data
    if (!Array.isArray(data)) {
      throw new Error('Invalid response from Todoist API: expected array of tasks');
    }

    return data.map((task) => TodoistTaskSchema.parse(task));
  }

  /**
   * Get a single task by ID
   */
  async getTask(taskId: string): Promise<TodoistTask> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get task (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return TodoistTaskSchema.parse(data);
  }

  /**
   * Complete a task
   */
  async completeTask(taskId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}/close`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to complete task (${response.status}): ${errorText}`);
    }
  }

  /**
   * Create a new task
   */
  async createTask(taskData: CreateTodoistTask): Promise<TodoistTask> {
    // Validate input
    const validated = CreateTodoistTaskSchema.parse(taskData);

    const response = await fetch(`${this.baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validated),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create task (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return TodoistTaskSchema.parse(data);
  }

  /**
   * Update a task
   */
  async updateTask(taskId: string, updates: Partial<CreateTodoistTask>): Promise<TodoistTask> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update task (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return TodoistTaskSchema.parse(data);
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete task (${response.status}): ${errorText}`);
    }
  }

  /**
   * Add a comment to a task
   */
  async addComment(taskId: string, content: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task_id: taskId,
        content,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to add comment (${response.status}): ${errorText}`);
    }
  }
}
