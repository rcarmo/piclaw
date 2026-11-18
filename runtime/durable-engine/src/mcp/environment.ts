// Metadata is not a shell. Keep loader/startup injection out of stdio environment edits.
const startupVariables = new Set([
  "ENV", "BASH_ENV", "NODE_OPTIONS", "NODE_PATH", "BUN_OPTIONS", "BUN_PRELOAD",
  "PYTHONHOME", "PYTHONPATH", "PYTHONSTARTUP", "RUBYOPT", "RUBYLIB",
  "PERL5OPT", "PERL5LIB", "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS",
  "DOTNET_STARTUP_HOOKS", "DOTNET_ADDITIONAL_DEPS",
]);

export function mcpEnvironmentNameIssue(name: string): string | undefined {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name === "__proto__" || name === "constructor" || name === "prototype") {
    return "Use ordinary environment variable names.";
  }
  if (/^(?:LD_|DYLD_)/i.test(name) || startupVariables.has(name.toUpperCase())) {
    return "Runtime loader and startup environment overrides are not permitted.";
  }
}

/** Validate metadata before resolving a reference; resolved secret values never return to metadata. */
export function mcpEnvironmentValueIssue(name: string, value: string): string | undefined {
  const nameIssue = mcpEnvironmentNameIssue(name);
  if (nameIssue) return nameIssue;
  if (value.includes("\0")) return "Environment values must not contain NUL bytes.";
  if (/(?:^|_)(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|AUTHORIZATION)(?:_|$)/i.test(name) && !value.startsWith("keychain:")) {
    return "Sensitive environment fields require keychain references.";
  }
  if (value === "keychain:") return "A keychain reference name is required.";
}
