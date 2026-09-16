import { DurableObject } from "cloudflare:workers";

export class CategoryRoom extends DurableObject {
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const url = new URL(request.url);
    const nickname = (url.searchParams.get("nickname") || "anonymous").slice(0, 32);
    const id = crypto.randomUUID();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, nickname });

    this.broadcastUsers();

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  webSocketMessage(ws, message) {
    let data;

    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    const sender = ws.deserializeAttachment();

    if (!sender) return;

    // WebRTC signaling is forwarded only to the selected peer.
    if (["offer", "answer", "ice"].includes(data.type) && data.to) {
      for (const peer of this.ctx.getWebSockets()) {
        const info = peer.deserializeAttachment();

        if (info?.id === data.to) {
          peer.send(JSON.stringify({
            ...data,
            from: sender.id,
            fromNickname: sender.nickname
          }));
          break;
        }
      }
    }
  }

  webSocketClose() {
    this.broadcastUsers();
  }

  webSocketError() {
    this.broadcastUsers();
  }

  broadcastUsers() {
    const sockets = this.ctx.getWebSockets();

    const users = sockets
      .map(ws => ws.deserializeAttachment())
      .filter(Boolean);

    for (const ws of sockets) {
      const me = ws.deserializeAttachment();

      try {
        ws.send(JSON.stringify({
          type: "users",
          selfId: me?.id,
          users
        }));
      } catch {}
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/status") {
      return Response.json({
        name: "Slovakia Based",
        version: "0.2.0",
        status: "online"
      });
    }

    if (url.pathname === "/ws") {
      const category = (url.searchParams.get("category") || "general")
        .toLowerCase()
        .slice(0, 64);

      const id = env.CATEGORY_ROOM.idFromName(category);
      const room = env.CATEGORY_ROOM.get(id);

      return room.fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};
