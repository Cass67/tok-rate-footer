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
pi install git:github.com/<you>/tok-rate-footer
```

## Commands

- `/tok-rate` show status
- `/tok-rate on|off` enable/disable
- `/tok-rate reset` clear current measurement

## Notes

- Live rate uses streamed text/thinking/toolcall deltas.
- Final rate prefers provider usage output when available.
