/**
 * Token Rate Footer Extension
 *
 * Shows active model generation speed in pi footer status area.
 * - Live rate: estimated from streamed text/thinking/toolcall deltas (~4 chars/token)
 * - Final rate: uses provider usage.output when available, else estimate
 * - Commands:
 *   /tok-rate           show status
 *   /tok-rate on|off    enable/disable
 *   /tok-rate reset     clear current measurement
 */

type ExtensionContext = {
  model?: { provider?: string; id: string };
  ui: {
    theme: { fg(color: string, text: string): string };
    setStatus(key: string, value?: string): void;
    notify(text: string, level?: "info" | "warn" | "error"): void;
  };
};

type AssistantMessageEvent = {
  type: "text_delta" | "thinking_delta" | "toolcall_delta";
  delta: string;
};

type ExtensionAPI = {
  on(
    event: "session_start" | "model_select" | "agent_end",
    handler: (_event: unknown, ctx: ExtensionContext) => void | Promise<void>,
  ): void;
  on(
    event: "message_start",
    handler: (
      event: { message: { role: string } },
      ctx: ExtensionContext,
    ) => void | Promise<void>,
  ): void;
  on(
    event: "message_update",
    handler: (
      event: { assistantMessageEvent: AssistantMessageEvent },
      ctx: ExtensionContext,
    ) => void | Promise<void>,
  ): void;
  on(
    event: "message_end",
    handler: (
      event: {
        message: {
          role: string;
          usage?: { output?: number; cacheRead?: number; cacheWrite?: number };
        };
      },
      ctx: ExtensionContext,
    ) => void | Promise<void>,
  ): void;
  registerCommand(
    name: string,
    config: {
      description: string;
      handler: (args: string, ctx: ExtensionContext) => void | Promise<void>;
    },
  ): void;
};

type StreamState = {
  active: boolean;
  model: string;
  startedAt: number;
  lastAt: number;
  estimatedTokens: number;
  finalTokens?: number;
  finalRate?: number;
  cacheRead?: number;
  cacheWrite?: number;
};

const STATUS_KEY = "tok-rate";
const CHARS_PER_TOKEN = 4;

function modelLabel(ctx: any): string {
  const model = ctx.model;
  if (!model) return "no-model";
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

function fmtRate(rate: number | undefined): string {
  if (!Number.isFinite(rate ?? NaN)) return "--";
  const r = rate ?? 0;
  return r >= 100 ? r.toFixed(0) : r.toFixed(1);
}

function fmtCount(value: number | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return "--";
  const n = value ?? 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n.toFixed(0)}`;
}

function cacheSummary(state: StreamState): string | undefined {
  const read = state.cacheRead ?? 0;
  const write = state.cacheWrite ?? 0;
  if (read <= 0 && write <= 0) return undefined;
  const total = read + write;
  const hitRate = total > 0 ? (read / total) * 100 : 0;
  const hitLabel = read > 0 ? "HIT" : "MISS";
  return `${hitLabel} R${fmtCount(read)} W${fmtCount(write)} CH ${hitRate.toFixed(0)}%`;
}

function rateFrom(state: StreamState, now = Date.now()): number | undefined {
  const elapsed = Math.max(0.001, (now - state.startedAt) / 1000);
  const tokens = state.finalTokens ?? state.estimatedTokens;
  return tokens / elapsed;
}

function setStatus(
  ctx: any,
  state: StreamState | null,
  enabled: boolean,
  showDetails = false,
): void {
  if (!enabled) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }

  const theme = ctx.ui.theme;
  if (!state) {
    ctx.ui.setStatus(STATUS_KEY, theme.fg("dim", "tok/s"));
    return;
  }

  const rate = state.finalRate ?? rateFrom(state);
  const base = `${fmtRate(rate)} tok/s`;
  const cache = showDetails && !state.active ? cacheSummary(state) : undefined;
  const text = cache ? `${base} • ${cache}` : base;
  ctx.ui.setStatus(
    STATUS_KEY,
    theme.fg(state.active ? "accent" : "success", text),
  );
}

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let showDetails = false;
  let state: StreamState | null = null;

  pi.on("session_start", async (_event, ctx) => {
    setStatus(ctx, state, enabled, showDetails);
  });

  pi.on("model_select", async (_event, ctx) => {
    if (!state?.active) state = null;
    setStatus(ctx, state, enabled, showDetails);
  });

  pi.on("message_start", async (event, ctx) => {
    if (!enabled || event.message.role !== "assistant") return;
    const now = Date.now();
    state = {
      active: true,
      model: modelLabel(ctx),
      startedAt: now,
      lastAt: now,
      estimatedTokens: 0,
    };
    setStatus(ctx, state, enabled, showDetails);
  });

  pi.on("message_update", async (event, ctx) => {
    if (!enabled || !state?.active) return;

    const ev = event.assistantMessageEvent;
    if (
      ev.type === "text_delta" ||
      ev.type === "thinking_delta" ||
      ev.type === "toolcall_delta"
    ) {
      state.estimatedTokens += Math.max(0, ev.delta.length / CHARS_PER_TOKEN);
      state.lastAt = Date.now();
      setStatus(ctx, state, enabled, showDetails);
    }
  });

  pi.on("message_end", async (event, ctx) => {
    if (!enabled || !state?.active || event.message.role !== "assistant")
      return;

    const msg: any = event.message;
    const usageOutput = msg.usage?.output;
    const cacheRead = msg.usage?.cacheRead;
    const cacheWrite = msg.usage?.cacheWrite;
    const now = Date.now();
    const elapsed = Math.max(0.001, (now - state.startedAt) / 1000);
    state.active = false;
    state.finalTokens =
      typeof usageOutput === "number" && usageOutput > 0
        ? usageOutput
        : state.estimatedTokens;
    state.cacheRead = typeof cacheRead === "number" ? cacheRead : 0;
    state.cacheWrite = typeof cacheWrite === "number" ? cacheWrite : 0;
    state.finalRate = state.finalTokens / elapsed;
    state.lastAt = now;
    setStatus(ctx, state, enabled, showDetails);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (state?.active) {
      state.active = false;
      state.finalRate = rateFrom(state);
    }
    setStatus(ctx, state, enabled, showDetails);
  });

  pi.registerCommand("tok-rate", {
    description:
      "Show or toggle model token/sec footer status (usage: /tok-rate [on|off|reset|details on|details off])",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (arg === "off" || arg === "disable") {
        enabled = false;
        setStatus(ctx, state, enabled, showDetails);
        ctx.ui.notify("tok-rate footer disabled", "info");
        return;
      }
      if (arg === "on" || arg === "enable") {
        enabled = true;
        setStatus(ctx, state, enabled, showDetails);
        ctx.ui.notify("tok-rate footer enabled", "info");
        return;
      }
      if (arg === "reset") {
        state = null;
        setStatus(ctx, state, enabled, showDetails);
        ctx.ui.notify("tok-rate footer reset", "info");
        return;
      }
      if (arg === "details on" || arg === "details enable") {
        showDetails = true;
        setStatus(ctx, state, enabled, showDetails);
        ctx.ui.notify("tok-rate footer details enabled", "info");
        return;
      }
      if (arg === "details off" || arg === "details disable") {
        showDetails = false;
        setStatus(ctx, state, enabled, showDetails);
        ctx.ui.notify("tok-rate footer details disabled", "info");
        return;
      }

      setStatus(ctx, state, enabled, showDetails);
      const cache = state ? cacheSummary(state) : undefined;
      const text = state
        ? `${state.model}: ${fmtRate(state.finalRate ?? rateFrom(state))} tok/s${cache ? ` • ${cache}` : ""}`
        : `${modelLabel(ctx)}: -- tok/s`;
      ctx.ui.notify(text, "info");
    },
  });
}
