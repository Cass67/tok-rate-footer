import assert from 'node:assert/strict';
import tokRateFooter from './tok-rate-footer.ts';

function setup() {
  const handlers = new Map();
  const commands = new Map();
  tokRateFooter({
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerCommand(name, config) {
      commands.set(name, config);
    },
  });

  const statuses = [];
  const notices = [];
  const ctx = {
    model: { provider: 'test', id: 'model' },
    ui: {
      theme: { fg: (_color, text) => text },
      setStatus: (key, value) => statuses.push([key, value]),
      notify: (text, level) => notices.push([level, text]),
    },
  };

  return { handlers, commands, statuses, notices, ctx };
}

async function finishAssistantMessage(env) {
  await env.handlers.get('message_start')({ message: { role: 'assistant' } }, env.ctx);
  await env.handlers.get('message_update')(
    { assistantMessageEvent: { type: 'text_delta', delta: '1234567890123456' } },
    env.ctx,
  );
  await env.handlers.get('message_end')(
    {
      message: {
        role: 'assistant',
        usage: { output: 8, cacheRead: 6, cacheWrite: 2 },
      },
    },
    env.ctx,
  );
}

{
  const env = setup();
  await env.handlers.get('session_start')({}, env.ctx);
  assert.equal(env.statuses.at(-1)?.[1], 'tok/s');
}

{
  const env = setup();
  await finishAssistantMessage(env);
  const footer = env.statuses.at(-1)?.[1];
  assert.match(footer, /tok\/s/);
  assert.doesNotMatch(footer, /HIT|MISS|\bR\d|\bW\d|\bCH\b/);
}

{
  const env = setup();
  await env.commands.get('tok-rate').handler('details on', env.ctx);
  await finishAssistantMessage(env);
  const footer = env.statuses.at(-1)?.[1];
  assert.match(footer, /tok\/s/);
  assert.match(footer, /HIT R6 W2 CH 75%/);
}

{
  const env = setup();
  await env.commands.get('tok-rate').handler('details off', env.ctx);
  assert.equal(env.notices.at(-1)?.[1], 'tok-rate footer details disabled');
}

console.log('tok-rate-footer tests passed');
