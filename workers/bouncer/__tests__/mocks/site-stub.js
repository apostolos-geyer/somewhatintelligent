// Site upstream stub for vitest — the Astro public site (RFC-0001 D12).
// Site is a passthrough ROOT mount, so this stub exists to prove what bouncer
// must NOT do to it: no path strip (echoes the received path), no asset-URL
// rewriting, no si-mount meta injection. The root-relative asset URLs below
// are exactly what the vmf pipeline rewrites when an upstream IS mounted —
// if Site were ever mis-declared as vmf, the assertions against this HTML
// fail.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const html = `<!DOCTYPE html>
<html>
<head>
	<title>Site stub</title>
	<link rel="stylesheet" href="/assets/site.css">
	<link rel="icon" href="/favicon.ico">
</head>
<body>
	<h1>Site stub</h1>
	<p>Path: ${url.pathname}</p>
	<script src="/_astro/client.js"></script>
</body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
};
