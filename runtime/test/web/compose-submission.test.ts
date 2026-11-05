import { expect, test } from 'bun:test';
import { isComposeSteerShortcut, requireComposeAcknowledgement } from '../../web/src/ui/compose-submission.js';

test('Ctrl and Cmd Enter explicitly steer, preserving newline/IME/handled/repeated events', () => {
  expect(isComposeSteerShortcut({ key: 'Enter', ctrlKey: true })).toBe(true);
  expect(isComposeSteerShortcut({ key: 'Enter', metaKey: true })).toBe(true);
  for (const patch of [{ shiftKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }, { defaultPrevented: true }, { key: 'a' }]) {
    expect(isComposeSteerShortcut({ key: 'Enter', ctrlKey: true, ...patch })).toBe(false);
  }
  expect(isComposeSteerShortcut({ key: 'Enter' })).toBe(false);
});
test('queue/steer/durable message and explicit control outcomes confirm acceptance', () => {
  for (const response of [{ queued: 'followup' }, { queued: 'steer' }, { thread_id: 10 }, { user_message: { id: 10 } }, { command: { status: 'success' } }, { ui_only: true }, { source_committed: true }]) {
    expect(() => requireComposeAcknowledgement(response)).not.toThrow();
  }
});
test('committed relay-source receipt is retained even when forwarding fails', () => {
  expect(() => requireComposeAcknowledgement({ source_committed: true, relayed: false, error: 'Forwarding unavailable' })).not.toThrow();
});
test('empty or rejected successful HTTP payloads do not silently consume a draft', () => {
  for (const response of [null, {}, { status: 'error' }, { error: 'Rejected' }, { command: { status: 'error', message: 'Rejected' } }]) {
    expect(() => requireComposeAcknowledgement(response)).toThrow();
  }
});

test('accepted UI command with failed reply delivery remains accepted and has an explicit notice',async()=>{
 const {getComposeDeliveryNotice}=await import('../../web/src/ui/compose-submission');const response={ui_only:true,command:{status:'success'},response_delivery:'failed'};expect(()=>requireComposeAcknowledgement(response)).not.toThrow();expect(getComposeDeliveryNotice(response)).toBe('Command handled, but its timeline reply could not be delivered. Do not resend the command.');expect(getComposeDeliveryNotice({...response,response_delivery:'persisted'})).toBeNull();
});

test('an exact saved input receipt prevents duplicate draft restoration without claiming SDK placement',async()=>{
  const {isCommittedComposeInput,getComposeDeliveryNotice}=await import('../../web/src/ui/compose-submission.js');
  const receipt={accepted:true,thread_id:17,error:'Input saved; SDK admission could not be confirmed.'};
  expect(isCommittedComposeInput(receipt)).toBe(true);expect(()=>requireComposeAcknowledgement(receipt)).not.toThrow();
  expect(getComposeDeliveryNotice(receipt)).toBe('Input saved, but SDK admission is unconfirmed. Do not resend this input.');
  for(const patch of [{accepted:false},{accepted:'true'},{thread_id:null},{thread_id:0},{thread_id:-1},{thread_id:'17'},{thread_id:Infinity},{thread_id:1.5}]){
    const invalid={...receipt,...patch};expect(isCommittedComposeInput(invalid)).toBe(false);expect(()=>requireComposeAcknowledgement(invalid)).toThrow();expect(getComposeDeliveryNotice(invalid)).toBeNull();
  }
});
