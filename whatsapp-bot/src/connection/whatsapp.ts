// This file is retired. Logic has moved to sessionManager.ts.
// All files that previously imported from here have been updated to use
// sessionManager.ts or no longer need these exports.

/** @deprecated Per-session socket is now in SessionEntry. Use getSocketForUser(userId). */
export function getSocket(): import('baileys').WASocket | null {
  return null;
}

/** @deprecated Per-session JID is now stored in SessionEntry. */
export function getMyPhoneJid(): string | null {
  return null;
}

/** @deprecated Use trackSentMessage(userId, id) from sessionManager. */
export function trackSentMessage(_id: string): void {}

/** @deprecated Use storeSentMessage(userId, id, message) from sessionManager. */
export function storeSentMessage(_id: string, _message: any): void {}
