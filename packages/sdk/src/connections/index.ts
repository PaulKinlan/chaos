export interface ApiMessage {
  type: string;
  [key: string]: unknown;
}

export interface ApiResponse {
  [key: string]: unknown;
}

export interface ApiEvent {
  type: string;
  [key: string]: unknown;
}

export interface EngineConnection {
  send(message: ApiMessage): Promise<ApiResponse>;
  stream(message: ApiMessage): AsyncIterable<ApiEvent>;
  subscribe(event: string, handler: (data: unknown) => void): () => void;
  disconnect(): void;
}

export interface RelayConnection {
  register(): Promise<{ userId: string; apiKey: string }>;
  fetch(path: string, options?: RequestInit): Promise<Response>;
  connect(): Promise<{ close(): void; onMessage(handler: (msg: unknown) => void): void }>;
}
