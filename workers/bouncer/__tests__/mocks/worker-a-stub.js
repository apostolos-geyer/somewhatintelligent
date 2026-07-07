// Verbatim from microfrontend-template/vitest.config.ts (workerAScript).
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const html = `<!DOCTYPE html>
<html>
<head>
	<title>Worker A</title>
	<link rel="stylesheet" href="/assets/style.css">
	<link rel="icon" href="/favicon.ico">
</head>
<body>
	<h1>Worker A</h1>
	<p>Path: ${url.pathname}</p>
	<img src="/assets/logo.png" alt="Logo">
	<script src="/static/app.js"></script>
</body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
};
