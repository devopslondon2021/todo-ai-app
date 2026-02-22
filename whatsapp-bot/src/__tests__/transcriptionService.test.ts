import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env
vi.mock('../config/env.js', () => ({
  env: {
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'test-key',
  },
}));

// Mock baileys downloadMediaMessage
vi.mock('baileys', () => ({
  downloadMediaMessage: vi.fn(),
}));

// Mock openai — must use regular function for `new` compatibility
const mockCreate = vi.fn();
vi.mock('openai', () => {
  function OpenAI() {
    return { audio: { transcriptions: { create: mockCreate } } };
  }
  return {
    default: OpenAI,
    toFile: vi.fn(async (buf: Buffer, name: string) => ({ name, buffer: buf })),
  };
});

import { transcribeVoiceMessage } from '../services/transcriptionService.js';
import { downloadMediaMessage } from 'baileys';
import { env } from '../config/env.js';

const mockMsg = {
  key: { remoteJid: '123@s.whatsapp.net' },
  message: { audioMessage: { ptt: true } },
} as any;

describe('transcribeVoiceMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (env as any).AI_PROVIDER = 'openai';
  });

  it('returns null when AI_PROVIDER is ollama', async () => {
    (env as any).AI_PROVIDER = 'ollama';
    const result = await transcribeVoiceMessage(mockMsg);
    expect(result).toBeNull();
    expect(downloadMediaMessage).not.toHaveBeenCalled();
  });

  it('transcribes audio and returns text', async () => {
    vi.mocked(downloadMediaMessage).mockResolvedValue(Buffer.from('audio'));
    mockCreate.mockResolvedValue({ text: '  buy groceries tomorrow  ' });

    const result = await transcribeVoiceMessage(mockMsg);
    expect(result).toBe('buy groceries tomorrow');
    expect(downloadMediaMessage).toHaveBeenCalledWith(mockMsg, 'buffer', {});
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini-transcribe' })
    );
  });

  it('returns null for empty transcription', async () => {
    vi.mocked(downloadMediaMessage).mockResolvedValue(Buffer.from('audio'));
    mockCreate.mockResolvedValue({ text: '   ' });

    const result = await transcribeVoiceMessage(mockMsg);
    expect(result).toBeNull();
  });

  it('returns null when transcription text is undefined', async () => {
    vi.mocked(downloadMediaMessage).mockResolvedValue(Buffer.from('audio'));
    mockCreate.mockResolvedValue({});

    const result = await transcribeVoiceMessage(mockMsg);
    expect(result).toBeNull();
  });

  it('propagates download errors', async () => {
    vi.mocked(downloadMediaMessage).mockRejectedValue(new Error('Download failed'));

    await expect(transcribeVoiceMessage(mockMsg)).rejects.toThrow('Download failed');
  });
});
