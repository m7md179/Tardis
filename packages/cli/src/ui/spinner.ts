import ora, { Ora } from 'ora';

/**
 * CLI spinner wrapper for async operations
 */
export class Spinner {
  private spinner: Ora;

  constructor(text?: string) {
    this.spinner = ora({
      text: text || 'Loading...',
      color: 'cyan',
    });
  }

  /**
   * Start the spinner
   */
  start(text?: string): this {
    if (text) {
      this.spinner.text = text;
    }
    this.spinner.start();
    return this;
  }

  /**
   * Update spinner text
   */
  text(text: string): this {
    this.spinner.text = text;
    return this;
  }

  /**
   * Stop spinner with success
   */
  succeed(text?: string): this {
    this.spinner.succeed(text);
    return this;
  }

  /**
   * Stop spinner with failure
   */
  fail(text?: string): this {
    this.spinner.fail(text);
    return this;
  }

  /**
   * Stop spinner with warning
   */
  warn(text?: string): this {
    this.spinner.warn(text);
    return this;
  }

  /**
   * Stop spinner with info
   */
  info(text?: string): this {
    this.spinner.info(text);
    return this;
  }

  /**
   * Stop spinner
   */
  stop(): this {
    this.spinner.stop();
    return this;
  }

  /**
   * Clear spinner
   */
  clear(): this {
    this.spinner.clear();
    return this;
  }
}

/**
 * Create a new spinner instance
 */
export function spinner(text?: string): Spinner {
  return new Spinner(text);
}

/**
 * Run an async function with a spinner
 */
export async function withSpinner<T>(
  text: string,
  fn: () => Promise<T>,
  successText?: string
): Promise<T> {
  const spin = new Spinner(text).start();

  try {
    const result = await fn();
    spin.succeed(successText || text);
    return result;
  } catch (error) {
    spin.fail(`${text} failed`);
    throw error;
  }
}
