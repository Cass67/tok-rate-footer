# tok-rate-footer

Pi extension that shows live token/sec in footer.

## Install

### Local

Put `tok-rate-footer.ts` in:

- `~/.pi/agent/extensions/`
- or `.pi/extensions/`

Then run `/reload`.

### Git / package

```bash
pi install git:github.com/Cass67/tok-rate-footer
```

Pin a ref if you want a fixed version:

```bash
pi install git:github.com/Cass67/tok-rate-footer@main
```

## Commands

- `/tok-rate` show status
- `/tok-rate on|off` enable/disable
- `/tok-rate reset` clear current measurement
- `/tok-rate details on|off` show/hide cache details in footer (default: off)

## Notes

- Live rate uses streamed text/thinking/toolcall deltas.
- Final rate prefers provider usage output when available.
- Footer defaults to rate-only (`tok/s`) to avoid duplicating provider/statusline details.
- Footer can show cache info when enabled and provider returns `usage.cacheRead` / `usage.cacheWrite`.
