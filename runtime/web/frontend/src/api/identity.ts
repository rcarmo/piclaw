import { signal } from "@preact/signals";

/** Global identity info — populated from /timeline response, served from avatar endpoints. */
export const userAvatarUrl = signal<string | null>("/avatar/user");
export const assistantAvatarUrl = signal<string>("/avatar/agent");
