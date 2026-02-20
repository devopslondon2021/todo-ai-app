import OpenAI from 'openai';
import { env } from './env';

export type AIProvider = 'openai' | 'ollama';

let currentProvider: AIProvider = env.AI_PROVIDER;

function createOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}

function createOllamaClient(): OpenAI {
  return new OpenAI({
    baseURL: env.OLLAMA_BASE_URL + '/v1',
    apiKey: 'ollama',
  });
}

export function getAIClient(): OpenAI {
  return currentProvider === 'ollama' ? createOllamaClient() : createOpenAIClient();
}

export function getModelName(): string {
  return currentProvider === 'ollama' ? env.OLLAMA_MODEL : 'gpt-4o-mini';
}

export function setProvider(provider: AIProvider): void {
  currentProvider = provider;
}

export function getProvider(): AIProvider {
  return currentProvider;
}
