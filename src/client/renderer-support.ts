import type { OpenUIError } from "@openuidev/lang-core";

type RendererState = Record<string, unknown>;
type StateStorage = Pick<Storage, "getItem" | "setItem">;

const STATE_PREFIX = "dsh-openui:renderer-state:v1:";

export function rendererStateKey(callId: string) {
  return `${STATE_PREFIX}${callId}`;
}

export function loadRendererState(storage: StateStorage, callId: string): RendererState | undefined {
  try {
    const raw = storage.getItem(rendererStateKey(callId));
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as RendererState
      : undefined;
  } catch {
    return undefined;
  }
}

export function saveRendererState(storage: StateStorage, callId: string, state: RendererState) {
  storage.setItem(rendererStateKey(callId), JSON.stringify(state));
}

export function rendererErrorMessages(errors: OpenUIError[]) {
  return errors
    .filter((error) => error.severity !== "warning")
    .map((error) => {
      const location = error.statementId ?? error.component;
      return [location ? `[${location}]` : "", error.message, error.hint].filter(Boolean).join(" ");
    });
}
