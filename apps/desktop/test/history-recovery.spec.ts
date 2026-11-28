import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION } from '@cc-desk-tunnel/protocol';
import { resolve } from 'node:path';
import { screenshots } from './helpers.ts';

test('stale tools stop spinning, stalled history can pause and retry without resending work', async ({
  page,
}) => {
  const connectionId = randomUUID();
  const runId = randomUUID();
  const now = new Date().toISOString();
  const session = {
    id: randomUUID(),
    title: '历史恢复验证',
    projectPath: 'D:\\test',
    permissionMode: 'auto',
    createdAt: now,
    updatedAt: now,
    activeRun: { id: runId, status: 'running', connectionId },
  };
  const stopped = { ...session, activeRun: null };
  const other = { ...stopped, id: randomUUID(), title: '另一会话' };
  const event = (sequence: number, payload: object) => ({
    sessionId: session.id,
    runId,
    sequence,
    createdAt: now,
    payload,
  });
  const cached = [
    event(1, { type: 'message.user', messageId: randomUUID(), text: '查看图片', scenario: 'chat' }),
    event(2, {
      type: 'tool.requested',
      toolId: 'read-image',
      name: 'Read',
      input: '{"file_path":"image.jpg"}',
      target: 'Windows',
    }),
  ];
  const liveRun = randomUUID();
  const liveEvents = [
    {
      ...event(6, {
        type: 'message.user',
        messageId: randomUUID(),
        text: '无需历史，开始新任务',
        scenario: 'chat',
      }),
      runId: liveRun,
    },
    {
      ...event(7, {
        type: 'text.delta',
        messageId: randomUUID(),
        text: '这是暂停同步后的新回复。',
      }),
      runId: liveRun,
    },
    { ...event(8, { type: 'run.status', status: 'completed', connectionId }), runId: liveRun },
  ];
  let send: (value: unknown) => void = () => {};
  const requests: {
    type: string;
    requestId: string;
    afterSequence?: number;
    afterCreatedAt?: string;
  }[] = [];
  let subscriptions = 0;
  await page.routeWebSocket('ws://127.0.0.1:18891/ws', (route) => {
    send = (value) => route.send(JSON.stringify(value));
    route.onMessage((raw) => {
      const command = JSON.parse(String(raw));
      requests.push(command);
      if (
        command.type === 'device' ||
        command.type === 'session.history.next' ||
        command.type === 'session.history.cancel'
      )
        return;
      if (command.type === 'auth')
        return send({
          type: 'ready',
          protocolVersion: PROTOCOL_VERSION,
          serverDeviceId: '00000000-0000-4000-8000-000000000001',
          version: '0.3.22',
          adapter: 'simulation',
          connectionId,
          projects: [],
          sessions: [session, other],
        });
      if (command.type === 'session.subscribe') {
        if (command.sessionId === other.id) {
          send({
            type: 'session.snapshot',
            requestId: command.requestId,
            session: other,
            mode: 'replace',
            firstSequence: 0,
            lastSequence: 0,
            hasEarlier: false,
            events: [],
          });
          send({ type: 'response', requestId: command.requestId, ok: true });
          return;
        }
        subscriptions++;
        if (subscriptions > 1) {
          send({
            type: 'session.history.part',
            sessionId: session.id,
            requestId: command.requestId,
            data: '[',
            last: false,
          });
          return;
        }
        send({
          type: 'session.snapshot',
          requestId: command.requestId,
          session,
          mode: 'replace',
          firstSequence: 1,
          lastSequence: 2,
          hasEarlier: false,
          events: cached,
        });
      }
      if (command.type === 'message.send') {
        send({
          type: 'session.updated',
          session: { ...session, activeRun: { id: liveRun, status: 'running', connectionId } },
        });
        for (const event of liveEvents) send({ type: 'session.event', event });
        send({ type: 'session.updated', session: stopped });
      }
      send({ type: 'response', requestId: command.requestId, ok: true });
    });
  });
  await page.goto('/');
  await page.getByLabel('服务地址', { exact: true }).fill('ws://127.0.0.1:18891/ws');
  await page.getByLabel('服务凭据', { exact: true }).fill('test-only-history-recovery-token');
  await page.getByRole('button', { name: '连接', exact: true }).click();
  const row = page.locator('.session-select').filter({ hasText: session.title });
  await row.click();
  await page.locator('details.work > summary').click();
  await expect(page.locator('.tool .spinning')).toHaveCount(1);
  await page.locator('.session-select').filter({ hasText: other.title }).click();
  await row.click();
  send({ type: 'session.updated', session: stopped });
  const banner = page.getByRole('status', { name: '历史同步状态' });
  await expect(banner).toContainText('已接收 1 段');
  await expect(banner).toContainText('服务端当前无运行中的任务');
  await expect(page.locator('.tool .spinning')).toHaveCount(0);
  await page.locator('details.work > summary').click();
  await expect(page.locator('.tool')).toContainText('等待同步结果');
  await page.screenshot({ path: resolve(screenshots, 'history-recovery-syncing.png') });
  await page.getByRole('button', { name: '暂停历史同步', exact: true }).click();
  await expect(banner).toContainText('已暂停');
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('无需历史，开始新任务');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('这是暂停同步后的新回复。', { exact: true })).toBeVisible();
  await expect(banner).toContainText('旧记录稍后同步');
  await page.screenshot({ path: resolve(screenshots, 'history-paused-new-reply.png') });
  await page.getByRole('button', { name: '重试历史同步', exact: true }).click();
  await expect.poll(() => subscriptions).toBe(3);
  const retry = requests.filter((request) => request.type === 'session.subscribe').at(-1)!;
  expect(retry.afterSequence).toBe(2);
  expect(retry.afterCreatedAt).toBe(now);
  send({ type: 'response', requestId: retry.requestId, ok: false, message: '测试：历史传输停滞' });
  await expect(banner).toContainText('测试：历史传输停滞');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar-shade')).not.toBeVisible();
  await expect(banner).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(screenshots, 'history-recovery-narrow.png') });
  await page.getByRole('button', { name: '重试历史同步', exact: true }).click();
  await expect.poll(() => subscriptions).toBe(4);
  const final = requests.filter((request) => request.type === 'session.subscribe').at(-1)!;
  const pageText = JSON.stringify([
    {
      type: 'session.snapshot',
      requestId: final.requestId,
      session: stopped,
      mode: 'append',
      firstSequence: 3,
      lastSequence: 8,
      hasEarlier: false,
      events: [
        event(3, {
          type: 'tool.result',
          status: 'completed',
          toolId: 'read-image',
          output: 'image result',
          exitCode: 0,
        }),
        event(4, { type: 'text.delta', messageId: randomUUID(), text: '图片已经检查完成。' }),
        event(5, { type: 'run.status', status: 'completed', connectionId }),
        ...liveEvents,
      ],
    },
  ]);
  send({
    type: 'session.history.part',
    requestId: final.requestId,
    sessionId: session.id,
    data: pageText.slice(1),
    last: true,
  });
  send({ type: 'response', requestId: final.requestId, ok: true });
  await expect(banner).toHaveCount(0);
  await expect(page.getByText('图片已经检查完成。', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeEnabled();
  expect(requests.filter((request) => ['run.cancel', 'leave'].includes(request.type))).toHaveLength(
    0,
  );
  expect(requests.filter((request) => request.type === 'message.send')).toHaveLength(1);
  await expect(page.getByText('这是暂停同步后的新回复。', { exact: true })).toHaveCount(1);
});
