// Verbatim from microfrontend-template/vitest.config.ts (workerBScript).
export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/redirect-test") {
      return new Response(null, {
        status: 302,
        headers: { Location: "/redirected" },
      });
    }

    if (url.pathname === "/set-cookie") {
      return new Response("Cookie set", {
        headers: { "Set-Cookie": "session=abc123; Path=/" },
      });
    }

    const html = `<!DOCTYPE html>
<html>
<head>
	<title>Worker B</title>
	<link rel="stylesheet" href="/build/style.css">
</head>
<body>
	<h1>Worker B</h1>
	<p>Path: ${url.pathname}</p>
	<img src="/assets/image.png" alt="Image">
</body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
};
