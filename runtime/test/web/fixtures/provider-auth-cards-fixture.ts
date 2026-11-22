import "./provider-auth-ui-matrix.js";
import { presentProviderAuth } from "../../../web/src/ui/provider-auth-presentation.js";

(window as any).showPrivateAuthFixture = (response: unknown) => presentProviderAuth(response, async () => ({ status: "ok" }));
(window as any).showPrivateAuthStalled = (response: unknown) => {
  (window as any).privateAuthAborted = false;
  return presentProviderAuth(response, async (_payload, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => { (window as any).privateAuthAborted = true; reject(new Error("aborted")); }, { once: true });
  }));
};
