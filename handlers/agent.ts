import { createRecoveryWidget } from '../services/native-widget-service';
import { sendDashboardWidget } from './dashboard';

export const process_chat = {
  async no_output_recovery_stalled(chatId: string, session: any) {
    const html = createRecoveryWidget('stuck', {
      onCompact: () => this.compactSession(chatId),
      onNewSession: () => this.createNewSession(chatId),
      onRetry: () => this.retryRecovery(chatId)
    });
    await sendDashboardWidget(html);
  },
  async no_output_escalated(chatId: string, session: any) {
    const html = createRecoveryWidget('exhausted', {
      onCompact: () => this.compactSession(chatId),
      onNewSession: () => this.createNewSession(chatId),
      onRetry: () => this.retryRecovery(chatId)
    });
    await sendDashboardWidget(html);
  },
  async compactSession(chatId: string) {
    // To be implemented with actual compaction logic
  },
  async createNewSession(chatId: string) {
    // To be implemented with actual new session logic
  },
  async retryRecovery(chatId: string) {
    // To be implemented with actual retry logic
  }
};
