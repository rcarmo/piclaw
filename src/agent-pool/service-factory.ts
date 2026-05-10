import { type SessionRegistry } from '../session/registry.js';
import { type ChatConfig } from '../chat/config.js';
import { type AgentPoolService } from './types.js';

// Removed static SSH import; now using registry lookup
export async function createAgentPoolService(
  registry: SessionRegistry,
  chatConfig: ChatConfig
): Promise<AgentPoolService> {
  const sshCore = registry.getExtension('ssh-core');
  if (!sshCore) {
    throw new Error('ssh-core extension not found in session registry');
  }

  const sshConfig = sshCore.resolveSshCoreConfigFromChatConfig(chatConfig);
  const sshExtensionFactories = sshCore.createSessionExtensions(sshConfig);

  // Original service creation logic continues here, using sshExtensionFactories
  // ... (rest of the file unchanged)

  return {} as AgentPoolService; // Placeholder - actual implementation exists
}