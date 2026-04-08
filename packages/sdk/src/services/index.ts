export interface ScheduledTask {
  id: string;
  name: string;
  scheduledTime?: number;
  periodInMinutes?: number;
}

export interface TaskScheduler {
  schedule(name: string, options: { delayInMinutes?: number; periodInMinutes?: number }): Promise<void>;
  list(): Promise<ScheduledTask[]>;
  cancel(name: string): Promise<void>;
  onTriggered(listener: (task: ScheduledTask) => Promise<void>): void;
}

export interface PageParser {
  parse(html: string, url: string): Promise<{ title: string; content: string; textContent: string }>;
}
