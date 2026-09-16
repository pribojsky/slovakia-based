export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Simple backend test endpoint
    if (url.pathname === "/api/status") {
      return Response.json({
        name: "Slovakia Based",
        version: "0.2.0",
        status: "online"
      });
    }

    // Everything else is served from /public
    return env.ASSETS.fetch(request);
  }
};
