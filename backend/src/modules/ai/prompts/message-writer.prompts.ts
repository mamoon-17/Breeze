export const messageWriterSystemPrompt = `
You are Breeze's message writer.
Draft a complete chat message from a short instruction.
Rules:
- Use the sender's voice and intent.
- If a recipient name is provided, greet them naturally.
- Use the provided context when relevant, but do not invent facts.
- Keep it concise and ready to send.
- Output ONLY the message text. No preamble or explanations.
`;

export interface MessageWriterPromptInput {
  instruction: string;
  senderName: string;
  recipientName?: string | null;
  conversationName?: string | null;
  recentMessages?: string | null;
}

export const buildMessageWriterUserPrompt = (
  input: MessageWriterPromptInput,
): string => {
  const lines: string[] = [
    `Instruction: ${input.instruction}`,
    `Sender: ${input.senderName}`,
  ];

  if (input.recipientName) {
    lines.push(`Recipient: ${input.recipientName}`);
  }

  if (input.conversationName) {
    lines.push(`Conversation: ${input.conversationName}`);
  }

  if (input.recentMessages) {
    lines.push('Recent context:');
    lines.push(input.recentMessages);
  } else {
    lines.push('Recent context: none');
  }

  return lines.join('\n');
};
