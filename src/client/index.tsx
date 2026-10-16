import "katex/dist/katex.min.css";
import "./client.css";

import { BuiltinActionType, Renderer, type ActionEvent } from "@openuidev/react-lang";
import { useCallback, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { CopyToClipboard } from "../openui/actions";
import { library } from "../openui/library";
import { readStreamingString } from "./streaming-json";

type InputActions = {
  setDraft(text: string): void;
  submit(): void;
};

type StartedBlock = { argsRaw: string };
type ResultBlock = { call: { argsRaw: string } };

type OpenUIToolViewProps = {
  callId: string;
  phase: "preparing" | "start" | "result";
  block: StartedBlock | ResultBlock;
  useToolCallArgumentsPartial(): string;
  inputActions: InputActions;
};

type RenderArgs = {
  program: string;
  title?: string;
};

function rawArguments(props: OpenUIToolViewProps, partial: string): string {
  if (props.phase === "preparing") return partial;
  if (props.phase === "start") return (props.block as StartedBlock).argsRaw;
  return (props.block as ResultBlock).call.argsRaw;
}

function streamedArgs(raw: string): RenderArgs {
  return {
    program: readStreamingString(raw, "program"),
    title: readStreamingString(raw, "title"),
  };
}

function finishedArgs(raw: string): RenderArgs {
  return JSON.parse(raw) as RenderArgs;
}

function assistantMessage(event: ActionEvent): string {
  const payload: Record<string, unknown> = {};
  const formState = event.formState ?? {};
  if (Object.keys(formState).length > 0) payload.formValues = formState;
  if (event.params.context !== undefined) payload.context = event.params.context;
  const suffix = Object.keys(payload).length === 0 ? "" : `\n\nOpenUI context:\n${JSON.stringify(payload, null, 2)}`;
  return `${event.humanFriendlyMessage}${suffix}`;
}

function OpenUICard({ args, streaming, inputActions }: {
  args: RenderArgs;
  streaming: boolean;
  inputActions: InputActions;
}) {
  const onAction = useCallback((event: ActionEvent) => {
    if (event.type === CopyToClipboard.name) {
      void navigator.clipboard.writeText(String(event.params.text));
      return;
    }
    if (event.type === BuiltinActionType.OpenUrl) {
      window.open(String(event.params.url), "_blank", "noopener,noreferrer");
      return;
    }
    if (event.type === BuiltinActionType.ContinueConversation) {
      inputActions.setDraft(assistantMessage(event));
      queueMicrotask(() => inputActions.submit());
    }
  }, [inputActions]);

  return (
    <section className="dsh-openui-card" aria-label={args.title || "Interactive UI"}>
      <header className="dsh-openui-head">
        {streaming && <span className="dsh-openui-live" aria-hidden />}
        <strong>{args.title || "Interactive UI"}</strong>
        {streaming && <span>生成中</span>}
      </header>
      {args.program ? (
        <div className="dsh-openui-body">
          <Renderer
            response={args.program}
            library={library}
            isStreaming={streaming}
            onAction={onAction}
          />
        </div>
      ) : (
        <div className="dsh-openui-empty">正在生成交互界面…</div>
      )}
      {!streaming && args.program && (
        <details className="dsh-openui-source">
          <summary>OpenUI Lang 源码</summary>
          <pre>{args.program}</pre>
        </details>
      )}
    </section>
  );
}

function mountPoint(marker: HTMLElement, callId: string) {
  const anchor = marker.closest<HTMLElement>("[data-chat-group-key]")
    ?? marker.closest<HTMLElement>("[data-chat-flow-key]")!;
  const root = document.createElement("div");
  root.className = "dsh-openui-portal";
  root.dataset.openuiCallId = callId;
  root.dataset.chatGroupPart = "response";
  let previous = anchor;
  while (previous.nextElementSibling?.classList.contains("dsh-openui-portal")) {
    previous = previous.nextElementSibling as HTMLElement;
  }
  previous.insertAdjacentElement("afterend", root);
  return root;
}

function OpenUIToolView(props: OpenUIToolViewProps) {
  const marker = useRef<HTMLSpanElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement>();
  const partial = props.useToolCallArgumentsPartial();
  const raw = rawArguments(props, partial);
  const streaming = props.phase === "preparing";
  const args = streaming ? streamedArgs(raw) : finishedArgs(raw);

  useLayoutEffect(() => {
    const root = mountPoint(marker.current!, props.callId);
    setPortalRoot(root);
    return () => root.remove();
  }, [props.callId]);

  return (
    <>
      <span ref={marker} className="dsh-openui-tool-status">
        {streaming ? "正在生成交互界面…" : "交互界面已显示在正文中"}
      </span>
      {portalRoot && createPortal(
        <OpenUICard args={args} streaming={streaming} inputActions={props.inputActions} />,
        portalRoot,
      )}
    </>
  );
}

export const inject = ["slots"];

export function apply(ctx: {
  slots: {
    inject(name: string, callback: () => () => void): () => void;
    register(options: {
      name: string;
      key?: string;
    }, component: ComponentType<any>): () => void;
  };
}) {
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "render_openui",
  }, OpenUIToolView));
}
