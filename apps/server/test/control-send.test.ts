import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { serverMessageSchema, type ServerMessage } from '@cc-desk-tunnel/protocol';
import { sendControl } from '../src/control-send.ts';

test(
  'large live image results let heartbeats through and arrive intact and in order',
  { timeout: 5000 },
  async (t) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0, perMessageDeflate: true });
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const connected = once(server, 'connection');
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    t.after(async () => {
      client.terminate();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await once(client, 'open');
    const [socket] = (await connected) as [WebSocket];

    const requestId = randomUUID();
    const sessionId = randomUUID();
    const history: ServerMessage = {
      type: 'session.history.part',
      requestId,
      sessionId,
      data: '历史'.repeat(1000),
      last: true,
    };
    const result: ServerMessage = {
      type: 'session.event',
      event: {
        sessionId,
        runId: randomUUID(),
        sequence: 1,
        createdAt: new Date().toISOString(),
        payload: {
          type: 'tool.result',
          toolId: 'image-read',
          status: 'completed',
          output: JSON.stringify([
            { type: 'text', text: '中文 🖼️'.repeat(5500) },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: randomBytes(300_000).toString('base64'),
              },
            },
          ]),
          exitCode: null,
        },
      },
    };
    const reply: ServerMessage = { type: 'response', requestId, ok: true };

    const received: ServerMessage[] = [];
    let pingBeforeResult = false;
    client.on('ping', () => {
      if (received.length === 1) pingBeforeResult = true;
    });
    const complete = new Promise<void>((resolve) => {
      client.on('message', (data, binary) => {
        assert.equal(binary, false);
        received.push(serverMessageSchema.parse(JSON.parse(data.toString())));
        if (received.length === 4) resolve();
      });
    });
    const pong = once(socket, 'pong', { signal: AbortSignal.timeout(3000) });
    const second = { ...result, event: { ...result.event, sequence: 2 } };
    for (const message of [history, result, second, reply]) sendControl(socket, message);

    await pong;
    await complete;
    assert.equal(pingBeforeResult, true);
    assert.deepEqual(received, [history, result, second, reply]);
  },
);
