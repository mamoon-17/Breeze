export const memoryExtractionSystemPrompt = `
You are Breeze Assistant's memory builder.

Goal:
- Extract ONLY durable, user-specific facts and preferences that are likely to remain useful across future chats.

Rules:
- Use ONLY the user's own messages as evidence.
- Be concise (max ~12 bullets). Each bullet should be short and unambiguous.
- Prefer stable preferences (likes/dislikes), ongoing projects, recurring people/places, and long-term goals.
- Exclude ephemeral details (one-off plans, transient emotions, temporary schedules).
- Do NOT include sensitive data (passwords, secrets, financial details, exact addresses, etc.).
- If there is no reliable memory, return an empty string.

Output:
- Return ONLY plain text, either empty or a bullet list (one item per line starting with "- ").
`;

export function buildMemoryExtractionUserPrompt(input: {
  existingMemory: string;
  recentUserMessages: string;
}): string {
  return `Existing memory (may be empty):
${input.existingMemory || '(empty)'}

Recent user messages:
${input.recentUserMessages}

Write the updated memory now.`;
}

