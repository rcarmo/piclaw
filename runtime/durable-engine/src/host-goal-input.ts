import { withExtensionKvAuthority } from "../../src/extension-kv-registry.js";
import type { PreparedInputText } from "../../src/channels/web/core/web-channel-contracts.js";

export interface GoalInputAddon {
  goalInputIdentity(text: string): { goalId: string; generation: number } | false | null;
  prepareGoalInput(text: string, chatJid: string): {
    decision: { action: "continue" } | { action: "handled" } | { action: "transform"; text: string };
    assertCurrent(): void;
  };
}

/** Keep the accepted input lifecycle-bound but human-sized. Expansion belongs
 * in hidden model context, never in the queued/timeline message. Old expanded
 * inputs remain unchanged; this only compacts newly transformed visible inputs. */
export function compactGoalInput(addon: Pick<GoalInputAddon, "goalInputIdentity">, text: string,
  decision: { action: string; text?: string }): string {
  if (decision.action !== "transform") return text;
  const identity = addon.goalInputIdentity(decision.text ?? "");
  if (!identity) throw Error("Goal input identity required");
  const visible = text.replace(/\n\n<piclaw_goal_input>[\s\S]*<\/piclaw_goal_input>$/, "");
  return visible + "\n\n<piclaw_goal_input>" + JSON.stringify(identity) + "</piclaw_goal_input>";
}

/** Read-only preparation before an accepted operation exists. The host must
 * validate the mapped chat and writer on preparation and every admission check. */
export function createHostGoalInput(addon: GoalInputAddon, assertAdmission: (chatJid: string) => void) {
  const prepare = addon.prepareGoalInput.bind(addon);
  return (chatJid: string, text: string): PreparedInputText => {
    const scope = <T>(body: () => T) => withExtensionKvAuthority({ extensionId: "goal", chatJid,
      assertCurrent() { assertAdmission(chatJid); },
      write() { throw Error("Goal input preparation is read-only"); },
    }, body);
    assertAdmission(chatJid);
    const prepared = scope(() => prepare(text, chatJid));
    if (prepared.decision.action === "handled") throw Error("Goal input is no longer executable");
    const content = compactGoalInput(addon, text, prepared.decision);
    return Object.freeze({ text: content, assertCurrent() {
      assertAdmission(chatJid);
      scope(() => prepared.assertCurrent());
    } });
  };
}
