#!/usr/bin/env tsx

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TRIPS_DIR = join(ROOT, "trips");

const marked = new Marked();

const CSS = `
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  max-width: 720px;
  margin: 0 auto;
  padding: 16px;
  line-height: 1.6;
  color: #1a1a1a;
  background: #fff;
}
h1 { font-size: 1.6em; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }
h2 { font-size: 1.3em; margin-top: 2em; color: #333; }
h3 { font-size: 1.1em; color: #555; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.9em; }
th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
th { background: #f5f5f5; font-weight: 600; }
tr:nth-child(even) { background: #fafafa; }
a { color: #1a73e8; text-decoration: none; }
a:hover { text-decoration: underline; }
hr { border: none; border-top: 1px solid #e0e0e0; margin: 2em 0; }
code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
blockquote { border-left: 3px solid #ddd; margin: 1em 0; padding: 0.5em 1em; color: #555; }
ul, ol { padding-left: 1.5em; }
li { margin: 0.3em 0; }
strong { color: #111; }
`.trim();

function stripFrontmatter(md: string): string {
	const match = md.match(/^---\n[\s\S]*?\n---\n/);
	return match ? md.slice(match[0].length) : md;
}

function toHtml(title: string, body: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function walkMarkdownFiles(dir: string): string[] {
	const files: string[] = [];
	if (!existsSync(dir)) return files;

	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			files.push(...walkMarkdownFiles(full));
		} else if (entry.endsWith(".md")) {
			files.push(full);
		}
	}
	return files;
}

function extractTitle(md: string, filename: string): string {
	const h1 = md.match(/^#\s+(.+)$/m);
	if (h1) return h1[1];
	const fmTitle = md.match(/^title:\s*"?(.+?)"?\s*$/m);
	if (fmTitle) return fmTitle[1];
	return basename(filename, ".md");
}

let converted = 0;

// Only convert itinerary files for each trip
for (const trip of readdirSync(TRIPS_DIR)) {
	const tripDir = join(TRIPS_DIR, trip);
	if (!statSync(tripDir).isDirectory()) continue;

	const itineraryDir = join(tripDir, "itinerary");
	const outputDir = join(tripDir, "itinerary-html");
	const mdFiles = walkMarkdownFiles(itineraryDir);
	if (mdFiles.length === 0) continue;

	mkdirSync(outputDir, { recursive: true });

	for (const mdPath of mdFiles) {
		const raw = readFileSync(mdPath, "utf-8");
		const clean = stripFrontmatter(raw);
		const title = extractTitle(raw, mdPath);
		const body = marked.parse(clean) as string;
		const html = toHtml(title, body);

		const htmlPath = join(outputDir, basename(mdPath).replace(/\.md$/, ".html"));
		writeFileSync(htmlPath, html);
		converted++;
	}
}

console.log(`Exported ${converted} HTML file(s) from trips/`);
