import { ServerConfig } from '../../config';

export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  priority: number;
  due?: {
    date: string;
    string: string;
  };
  labels: string[];
}

/**
 * Todoist API client for server
 */
export class TodoistClient {
  private apiToken: string;
  private readonly baseUrl = 'https://api.todoist.com/api/v1';

  constructor(config: ServerConfig) {
    this.apiToken = config.todoist.apiToken;
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
      throw new Error(`Todoist API error: ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : data.results ?? [];
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
      throw new Error(`Failed to complete task: ${response.status}`);
    }
  }

  /**
   * Create a new task
   */
  async createTask(content: string, description?: string, dueString?: string): Promise<TodoistTask> {
    const response = await fetch(`${this.baseUrl}/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content,
        description,
        due_string: dueString,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create task: ${response.status}`);
    }

    return response.json();
  }
}
