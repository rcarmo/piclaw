const sessionExtensionRegistry = new Map<string, any>();

if (typeof globalThis !== 'undefined') {
  globalThis.__piclaw_registerSessionExtension = (name: string, impl: any) => {
    sessionExtensionRegistry.set(name, impl);
  };
}

if (typeof globalThis.__piclawRuntimeInterop === 'undefined') {
  globalThis.__piclawRuntimeInterop = {};
}

globalThis.__piclawRuntimeInterop.buildInjectedShellEnv = (...args: any[]) => {
  const sshCore = sessionExtensionRegistry.get('ssh-core');
  if (sshCore && typeof sshCore.buildInjectedShellEnv === 'function') {
    return sshCore.buildInjectedShellEnv(...args);
  }
  throw new Error('ssh-core extension not registered');
};

globalThis.__piclawRuntimeInterop.resolveKeychainPlaceholders = (...args: any[]) => {
  const sshCore = sessionExtensionRegistry.get('ssh-core');
  if (sshCore && typeof sshCore.resolveKeychainPlaceholders === 'function') {
    return sshCore.resolveKeychainPlaceholders(...args);
  }
  throw new Error('ssh-core extension not registered');
};

globalThis.__piclawRuntimeInterop.getSshConfig = (...args: any[]) => {
  const sshCore = sessionExtensionRegistry.get('ssh-core');
  if (sshCore && typeof sshCore.getSshConfig === 'function') {
    return sshCore.getSshConfig(...args);
  }
  throw new Error('ssh-core extension not registered');
};

export class AgentPool {
  private options: any;

  constructor(options: any = {}) {
    this.options = options;
  }

  async createSession(config: any) {
    const ssh = sessionExtensionRegistry.get('ssh');
    if (!ssh || typeof ssh.createSession !== 'function') {
      throw new Error('SSH extension not registered');
    }
    return ssh.createSession(config);
  }

  async executeCommand(session: any, command: string) {
    const ssh = sessionExtensionRegistry.get('ssh');
    if (!ssh || typeof ssh.execute !== 'function') {
      throw new Error('SSH extension not registered');
    }
    return ssh.execute(session, command);
  }

  async closeSession(session: any) {
    const ssh = sessionExtensionRegistry.get('ssh');
    if (ssh && typeof ssh.close === 'function') {
      return ssh.close(session);
    }
  }
}
