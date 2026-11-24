import type { Socket } from 'node:net';
import type { WebSocket } from 'ws';

const CHECKPOINT = 32 * 1024;
const MIN_WINDOW = 2 * CHECKPOINT;
const MAX_WINDOW = 1024 * 1024;

// TCP writes here may finish as soon as a local proxy takes the bytes. A WebSocket
// pong echoing our byte offset means the device itself has read that far. Stop
// reading SSH when the window is full, so its own TCP flow control takes over.
export function sendSshBytes(source: Socket, peer: WebSocket, finish: () => void) {
  let sent = 0;
  let acknowledged = 0;
  let lastCheckpoint = 0;
  let lastProbeAt = 0;
  let window = MIN_WINDOW;
  const checkpoints = new Map<number, number>();
  let stalled: ReturnType<typeof setTimeout> | undefined;

  function checkpoint() {
    lastCheckpoint = sent;
    lastProbeAt = performance.now();
    checkpoints.set(sent, lastProbeAt);
    peer.ping(String(sent));
    // v0.3.16 checks for pongs even while it is receiving SSH data. Mark progress
    // in the byte stream in case its own ping is waiting behind a burst of traffic.
    peer.pong();
    stalled ??= setTimeout(() => peer.terminate(), 45_000).unref();
  }

  function read() {
    if (peer.readyState !== peer.OPEN) return;
    while (source.readableLength && sent - acknowledged < window) {
      const size = Math.min(
        source.readableLength,
        window - (sent - acknowledged),
        CHECKPOINT - (sent - lastCheckpoint),
      );
      const data: Buffer | null = source.read(size);
      if (!data) return;
      peer.send(data, { binary: true, compress: false });
      sent += data.length;
      if (sent - lastCheckpoint === CHECKPOINT) checkpoint();
    }
    // A final readable event may carry just EOF. Consume it even when there
    // are no bytes left, so an idle SSH client closing also closes its channel.
    if (!source.readableLength) source.read(0);
  }

  function pong(data: Buffer) {
    const offset = Number(data.toString());
    const start = checkpoints.get(offset);
    if (start === undefined) {
      // A peer may coalesce pings and echo the regular (empty) heartbeat instead.
      // Repeat the newest outstanding receipt without extending the stall deadline.
      if (
        !data.length &&
        checkpoints.size &&
        performance.now() - lastProbeAt > 5000 &&
        peer.readyState === peer.OPEN
      ) {
        lastProbeAt = performance.now();
        peer.ping(String(lastCheckpoint));
      }
      return;
    }
    const elapsed = performance.now() - start;
    if (elapsed < 500 && sent - acknowledged >= window)
      window = Math.min(MAX_WINDOW, window + CHECKPOINT);
    else if (elapsed > 2000) window = Math.max(MIN_WINDOW, Math.floor(window / 2));
    acknowledged = offset;
    for (const mark of checkpoints.keys()) {
      if (mark > offset) break;
      checkpoints.delete(mark);
    }
    if (checkpoints.size) stalled?.refresh();
    else {
      clearTimeout(stalled);
      stalled = undefined;
    }
    if (source.readableEnded && sent === acknowledged) finish();
    else read();
  }

  peer.on('pong', pong);
  source.on('readable', read);
  source.once('end', () => {
    if (peer.readyState !== peer.OPEN || sent === acknowledged) finish();
    else if (lastCheckpoint < sent) checkpoint();
  });
  peer.once('close', () => {
    clearTimeout(stalled);
    peer.off('pong', pong);
    source.off('readable', read);
    // Let the local socket finish even if it had unread input when the channel closed.
    source.resume();
  });
}
