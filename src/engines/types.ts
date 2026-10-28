export interface EngineContext {
  getConfig<T>(key: string, defaultValue: T): T;
  getSecret(key: string, settingKey: string): Promise<string | undefined>;
  timeout: number;
}

export interface Engine {
  readonly id: string;
  readonly name: string;
  /** 该引擎是否必需 API Key（用于配置提示） */
  readonly requiresKey: boolean;
  translate(text: string, from: string, to: string, ctx: EngineContext): Promise<string>;
}

export class MissingCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingCredentialError';
  }
}
