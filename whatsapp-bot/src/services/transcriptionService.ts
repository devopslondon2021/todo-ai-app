import { downloadMediaMessage } from 'baileys';
import type { proto, WAMessage } from 'baileys';
import OpenAI, { toFile } from 'openai';
import { env } from '../config/env.js';

/**
 * Transcribe a WhatsApp voice note (ptt) using OpenAI Whisper.
 * Returns the transcribed text, or null if transcription fails / provider is Ollama.
 */
export async function transcribeVoiceMessage(
  msg: proto.IWebMessageInfo
): Promise<string | null> {
  if (env.AI_PROVIDER === 'ollama') return null;

  // Cast needed: handler already validated msg.key exists
  const buffer = await downloadMediaMessage(msg as WAMessage, 'buffer', {});
  const file = await toFile(buffer as Buffer, 'voice.ogg', { type: 'audio/ogg' });

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const result = await client.audio.transcriptions.create({
    file,
    model: 'gpt-4o-mini-transcribe',
    language: 'en',
    prompt: 'Task management voice note. The user is adding, listing, or completing tasks. '
      + 'Transcribe names and proper nouns exactly as spoken.',
  });

  const text = result.text?.trim();
  return text || null;
}
