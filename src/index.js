export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/health") {
        return Response.json({ status: "ok", time: new Date().toISOString() });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    // Serve static files from /public (index.html, css, js, images)
    return env.ASSETS.fetch(request);
  },
};
