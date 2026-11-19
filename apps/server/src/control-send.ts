import { WebSocket } from 'ws';
import type { ServerMessage } from '@cc-desk-tunnel/protocol';

const FRAGMENT_BYTES = 32 * 1024;

export function sendControl(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState !== WebSocket.OPEN) return;

  const text = JSON.stringify(message);
  const compress = message.type === 'session.snapshot' || message.type === 'session.history.part';
  if (!compress && Buffer.byteLength(text) > FRAGMENT_BYTES) {
    const bytes = Buffer.from(text);
    // A receiver sees a data message only after its final frame. Put pings on the wire
    // between frames so slow transfers (such as image results) still show progress.
    // Queue the entire message in one turn so other data messages cannot interleave.
    for (let offset = 0; offset < bytes.length; offset += FRAGMENT_BYTES) {
      const end = offset + FRAGMENT_BYTES;
      const fin = end >= bytes.length;
      socket.send(bytes.subarray(offset, end), { binary: false, compress: false, fin });
      if (!fin) socket.ping();
    }
  } else {
    socket.send(text, { compress });
  }
}
