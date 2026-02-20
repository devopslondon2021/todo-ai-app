import OpenAI from 'openai';
import { env } from './env.js';

export function getAIClient(): OpenAI {
  if (env.AI_PROVIDER === 'ollama') {
    return new OpenAI({
      baseURL: env.OLLAMA_BASE_URL + '/v1',
      apiKey: 'ollama',
    });
  }
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}

export function getModelName(): string {
  return env.AI_PROVIDER === 'ollama' ? env.OLLAMA_MODEL : 'gpt-4o-mini';
}
