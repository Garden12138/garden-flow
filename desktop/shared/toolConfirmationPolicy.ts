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
