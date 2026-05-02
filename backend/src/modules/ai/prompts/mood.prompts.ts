export type MoodKey =
  | 'neutral'
  | 'formal'
  | 'casual'
  | 'friendly'
  | 'creative'
  | 'funny'
  | 'empathetic'
  | 'assertive';

export const MOOD_LABELS: Record<MoodKey, string> = {
  neutral: 'Neutral',
  formal: 'Formal',
  casual: 'Casual',
  friendly: 'Friendly',
  creative: 'Creative',
  funny: 'Funny',
  empathetic: 'Empathetic',
  assertive: 'Assertive',
};

export const moodSystemPrompt = (mood: MoodKey): string => `
You are a message rephraser for Breeze, a chat app.
Rewrite the user's message with a ${mood} tone.
Rules:
- Preserve the original meaning exactly.
- Do NOT add new information or context.
- Output ONLY the rephrased message — no preamble, no explanation, no quotes.
- Keep length within 20% of the original.
`;
