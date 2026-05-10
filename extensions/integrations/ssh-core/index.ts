const {
  buildInjectedShellEnv,
  resolveKeychainPlaceholders,
  getKeychainEntry,
  getChatJid,
  getSshConfig
} = __piclawRuntimeInterop;

__piclaw_registerSessionExtension('ssh-core', {
  buildInjectedShellEnv,
  resolveKeychainPlaceholders,
  getKeychainEntry,
  getChatJid,
  getSshConfig
});

if (__piclaw_registerToolStatusHintProvider) {
  __piclaw_registerToolStatusHintProvider('ssh-core', {
    getHint: () => {
      const config = getSshConfig();
      if (!config || Object.keys(config).length === 0) {
        return 'No SSH configuration found';
      }
      return null;
    }
  });
}

export {
  buildInjectedShellEnv,
  resolveKeychainPlaceholders,
  getKeychainEntry,
  getChatJid,
  getSshConfig
};
