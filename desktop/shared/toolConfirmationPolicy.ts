export type ToolConfirmationPolicyInput = {
  requiresConfirmation: boolean;
  requiresUserAcknowledgement: boolean;
  isAutoConfirmed: boolean;
};

export function shouldRequestToolConfirmation(input: ToolConfirmationPolicyInput): boolean {
  return input.requiresConfirmation && (input.requiresUserAcknowledgement || !input.isAutoConfirmed);
}

export function satisfiesUserAcknowledgement(
  requiresUserAcknowledgement: boolean,
  outcome: string,
): boolean {
  return !requiresUserAcknowledgement || outcome === 'proceed_after_user_acknowledgement';
}

export function buildDeferredToolConfirmationData(input: {
  callId: string;
  toolName: string;
  params: unknown;
}): {
  kind: 'tool-confirmation-pending';
  callId: string;
  toolName: string;
  proposalId?: string;
} {
  const record = input.params && typeof input.params === 'object' && !Array.isArray(input.params)
    ? input.params as Record<string, unknown>
    : {};
  const proposalId = String(record.proposalId || '').trim();
  return {
    kind: 'tool-confirmation-pending',
    callId: input.callId,
    toolName: input.toolName,
    ...(proposalId ? { proposalId } : {}),
  };
}
