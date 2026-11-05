/** Ctrl/Cmd+Enter steers; Shift+Enter remains a newline. */
export function isComposeSteerShortcut(event: { key?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; isComposing?: boolean; repeat?: boolean; defaultPrevented?: boolean }): boolean {
  return event.key === 'Enter' && Boolean(event.ctrlKey || event.metaKey)
    && !event.shiftKey && !event.altKey && !event.isComposing && !event.repeat && !event.defaultPrevented;
}

/** This proves only committed input storage, never SDK placement or execution. */
export function isCommittedComposeInput(response: any): boolean {
  return response?.accepted === true && Number.isSafeInteger(response.thread_id) && response.thread_id > 0;
}

/** Accepted input/commands must not be resent when only their handoff fails. */
export function getComposeDeliveryNotice(response: any): string | null {
  if(isCommittedComposeInput(response))return 'Input saved, but SDK admission is unconfirmed. Do not resend this input.';
  return response?.ui_only === true && response?.response_delivery === 'failed'
    ? 'Command handled, but its timeline reply could not be delivered. Do not resend the command.' : null;
}

export function requireComposeAcknowledgement(response: any): void {
  // A relay may commit the source but fail forwarding. Restoring it as unsent
  // would encourage a duplicate; its explicit committed receipt is authoritative.
  if (isCommittedComposeInput(response) || response?.source_committed === true) return;
  if (response?.command?.status === 'error' || response?.status === 'error' || response?.error) {
    throw new Error(typeof response.error === 'string' ? response.error : response.command?.message || response.message || 'Submission was rejected. Your draft has been preserved.');
  }
  const accepted = response && typeof response === 'object' && (
    response.queued === 'followup' || response.queued === 'steer'
    || response.user_message != null
    || response.thread_id != null
    || response.command?.status === 'success'
    || response.ui_only === true
    || response.source_committed === true
  );
  if (!accepted) throw new Error('The server response did not confirm acceptance. Your draft has been preserved; check the timeline or queue before retrying.');
}
