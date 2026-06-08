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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type StreamState = {
  active: boolean;
  model: string;
  startedAt: number;
  lastAt: number;
  estimatedTokens: number;
  finalTokens?: number;
  finalRate?: number;
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

function rateFrom(state: StreamState, now = Date.now()): number | undefined {
  const elapsed = Math.max(0.001, (now - state.startedAt) / 1000);
  const tokens = state.finalTokens ?? state.estimatedTokens;
  return tokens / elapsed;
}

function setStatus(
  ctx: any,
  state: StreamState | null,
  enabled: boolean,
): void {
  if (!enabled) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }

  const theme = ctx.ui.theme;
  if (!state) {
    ctx.ui.setStatus(STATUS_KEY, theme.fg("dim", "--"));
    return;
  }

  const rate = state.finalRate ?? rateFrom(state);
  ctx.ui.setStatus(
    STATUS_KEY,
    theme.fg(state.active ? "accent" : "success", fmtRate(rate)),
  );
}

export default function (pi: ExtensionAPI) {
  let enabled = true;
  let state: StreamState | null = null;

  pi.on("session_start", async (_event, ctx) => {
    setStatus(ctx, state, enabled);
  });

  pi.on("model_select", async (_event, ctx) => {
    if (!state?.active) state = null;
    setStatus(ctx, state, enabled);
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
    setStatus(ctx, state, enabled);
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
      setStatus(ctx, state, enabled);
    }
  });

  pi.on("message_end", async (event, ctx) => {
    if (!enabled || !state?.active || event.message.role !== "assistant")
      return;

    const msg: any = event.message;
    const usageOutput = msg.usage?.output;
    const now = Date.now();
    const elapsed = Math.max(0.001, (now - state.startedAt) / 1000);
    state.active = false;
    state.finalTokens =
      typeof usageOutput === "number" && usageOutput > 0
        ? usageOutput
        : state.estimatedTokens;
    state.finalRate = state.finalTokens / elapsed;
    state.lastAt = now;
    setStatus(ctx, state, enabled);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (state?.active) {
      state.active = false;
      state.finalRate = rateFrom(state);
    }
    setStatus(ctx, state, enabled);
  });

  pi.registerCommand("tok-rate", {
    description:
      "Show or toggle model token/sec footer status (usage: /tok-rate [on|off|reset])",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (arg === "off" || arg === "disable") {
        enabled = false;
        setStatus(ctx, state, enabled);
        ctx.ui.notify("tok-rate footer disabled", "info");
        return;
      }
      if (arg === "on" || arg === "enable") {
        enabled = true;
        setStatus(ctx, state, enabled);
        ctx.ui.notify("tok-rate footer enabled", "info");
        return;
      }
      if (arg === "reset") {
        state = null;
        setStatus(ctx, state, enabled);
        ctx.ui.notify("tok-rate footer reset", "info");
        return;
      }

      setStatus(ctx, state, enabled);
      const text = state
        ? `${state.model}: ${fmtRate(state.finalRate ?? rateFrom(state))}`
        : `${modelLabel(ctx)}: -- tok/s`;
      ctx.ui.notify(text, "info");
    },
  });
}
