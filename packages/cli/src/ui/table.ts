import { formatStatus, formatDurationColored, formatTaskName, dim } from '@tardis/shared';

/**
 * Column alignment options
 */
export type Alignment = 'left' | 'right' | 'center';

/**
 * Table column configuration
 */
export interface TableColumn<T> {
  header: string;
  key?: keyof T;
  width?: number;
  align?: Alignment;
  formatter?: (value: T) => string;
}

/**
 * Simple table renderer for CLI output
 */
export class Table<T> {
  private columns: TableColumn<T>[];
  private rows: T[];

  constructor(columns: TableColumn<T>[]) {
    this.columns = columns;
    this.rows = [];
  }

  /**
   * Add a row to the table
   */
  addRow(row: T): this {
    this.rows.push(row);
    return this;
  }

  /**
   * Add multiple rows to the table
   */
  addRows(rows: T[]): this {
    this.rows.push(...rows);
    return this;
  }

  /**
   * Render the table as a string
   */
  render(): string {
    if (this.rows.length === 0) {
      return 'No data to display';
    }

    const lines: string[] = [];

    // Calculate column widths
    const widths = this.calculateWidths();

    // Render header
    const headerRow = this.renderRow(
      this.columns.map((col) => col.header),
      widths,
      this.columns.map((col) => col.align || 'left')
    );
    lines.push(headerRow);

    // Render separator
    const separator = widths.map((width) => '-'.repeat(width)).join('  ');
    lines.push(separator);

    // Render rows
    for (const row of this.rows) {
      const cells = this.columns.map((col) => {
        if (col.formatter) {
          return col.formatter(row);
        }
        if (col.key) {
          const value = row[col.key];
          return String(value ?? '');
        }
        return '';
      });

      const rowLine = this.renderRow(
        cells,
        widths,
        this.columns.map((col) => col.align || 'left')
      );
      lines.push(rowLine);
    }

    return lines.join('\n');
  }

  /**
   * Print the table to console
   */
  print(): void {
    console.log('\n' + this.render() + '\n');
  }

  /**
   * Calculate column widths
   */
  private calculateWidths(): number[] {
    return this.columns.map((col, index) => {
      // Use specified width if provided
      if (col.width) {
        return col.width;
      }

      // Calculate max width needed
      let maxWidth = col.header.length;

      for (const row of this.rows) {
        let cellValue: string;
        if (col.formatter) {
          cellValue = col.formatter(row);
        } else if (col.key) {
          cellValue = String(row[col.key] ?? '');
        } else {
          cellValue = '';
        }

        // Strip ANSI codes for width calculation
        const plainValue = this.stripAnsi(cellValue);
        maxWidth = Math.max(maxWidth, plainValue.length);
      }

      return maxWidth;
    });
  }

  /**
   * Render a single row
   */
  private renderRow(cells: string[], widths: number[], alignments: Alignment[]): string {
    return cells
      .map((cell, index) => {
        const plainCell = this.stripAnsi(cell);
        const width = widths[index];
        const align = alignments[index];
        const padding = width - plainCell.length;

        if (align === 'right') {
          return ' '.repeat(padding) + cell;
        } else if (align === 'center') {
          const leftPad = Math.floor(padding / 2);
          const rightPad = padding - leftPad;
          return ' '.repeat(leftPad) + cell + ' '.repeat(rightPad);
        } else {
          return cell + ' '.repeat(padding);
        }
      })
      .join('  ');
  }

  /**
   * Strip ANSI color codes from string
   */
  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }
}

/**
 * Create a simple table
 */
export function table<T>(columns: TableColumn<T>[]): Table<T> {
  return new Table(columns);
}

/**
 * Create a session table with default formatting
 */
export function sessionTable(): Table<{
  taskName: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  duration: string;
  startTime: string;
}> {
  return new Table([
    {
      header: 'Task',
      formatter: (row) => formatTaskName(row.taskName),
      align: 'left',
    },
    {
      header: 'Status',
      formatter: (row) => formatStatus(row.status),
      align: 'center',
      width: 12,
    },
    {
      header: 'Duration',
      formatter: (row) => formatDurationColored(row.duration),
      align: 'right',
      width: 12,
    },
    {
      header: 'Started',
      formatter: (row) => dim(row.startTime),
      align: 'left',
    },
  ]);
}
