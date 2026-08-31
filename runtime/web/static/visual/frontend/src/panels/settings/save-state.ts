import type { SettingsData, WorkspaceSettings } from "./types";

/** Merge one successful settings response into the visual settings-data shape. */
export function mergeSavedSettings(
  current: SettingsData,
  endpoint: string,
  field: string,
  saved: SettingsData,
): SettingsData {
  if (endpoint === "workspace") {
    const workspace = saved as WorkspaceSettings;
    return {
      ...current,
      workspaceSettings: {
        ...current.workspaceSettings,
        ...(Object.hasOwn(workspace, field) ? { [field]: workspace[field as keyof WorkspaceSettings] } : {}),
      },
    };
  }
  return { ...current, ...saved };
}

/** Ignore stale responses when multiple saves for one field overlap. */
export class SettingsSaveGeneration {
  private readonly generations = new Map<string, number>();

  private key(endpoint: string, field: string): string {
    return `${endpoint}\0${field}`;
  }

  begin(endpoint: string, field: string): number {
    const key = this.key(endpoint, field);
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    return generation;
  }

  isCurrent(endpoint: string, field: string, generation: number): boolean {
    return this.generations.get(this.key(endpoint, field)) === generation;
  }
}
