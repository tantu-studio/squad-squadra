/**
 * Serializes parsed Wikivoyage articles into markdown files for the trip vault.
 *
 * Design: dump ALL data faithfully — no summarization, no field dropping.
 * An agent reading these files should have everything the API returned.
 */

import type { WikivoyageArticle, WikivoyageSection, WikivoyageListing } from "./wikivoyage.js";

function formatListing(l: WikivoyageListing): string {
	const lines: string[] = [`- **${l.name}**`];

	const meta: string[] = [];
	if (l.type !== "listing") meta.push(`type: ${l.type}`);
	if (l.lat != null && l.long != null) meta.push(`coords: ${l.lat}, ${l.long}`);
	if (l.price) meta.push(`price: ${l.price}`);
	if (l.hours) meta.push(`hours: ${l.hours}`);
	if (l.phone) meta.push(`phone: ${l.phone}`);
	if (l.email) meta.push(`email: ${l.email}`);
	if (l.url) meta.push(`url: ${l.url}`);
	if (l.directions) meta.push(`directions: ${l.directions}`);
	if (l.alt) meta.push(`alt: ${l.alt}`);

	if (meta.length > 0) {
		lines.push(`  ${meta.join(" | ")}`);
	}
	if (l.description) {
		lines.push(`  ${l.description}`);
	}

	return lines.join("\n");
}

function formatSection(section: WikivoyageSection): string {
	const heading = "#".repeat(Math.max(2, section.level)) + " " + section.title;
	const parts: string[] = [heading];

	if (section.content) {
		parts.push("", section.content);
	}

	if (section.listings.length > 0) {
		parts.push("");
		for (const listing of section.listings) {
			parts.push(formatListing(listing));
		}
	}

	return parts.join("\n");
}

export function articleToMarkdown(article: WikivoyageArticle, fetchedDate: string): string {
	const frontmatter = [
		"---",
		`title: "${article.title}"`,
		`page_id: ${article.pageId}`,
		`source: wikivoyage`,
		`fetched: "${fetchedDate}"`,
		`url: "https://en.wikivoyage.org/wiki/${encodeURIComponent(article.title.replace(/ /g, "_"))}"`,
		"---",
	].join("\n");

	const sections = article.sections.map(formatSection);

	return frontmatter + "\n\n" + sections.join("\n\n") + "\n";
}

export function buildIndex(articles: Array<{ title: string; slug: string; sectionCount: number; listingCount: number }>, fetchedDate: string): string {
	const frontmatter = [
		"---",
		`source: wikivoyage`,
		`fetched: "${fetchedDate}"`,
		`articles: ${articles.length}`,
		"---",
	].join("\n");

	const lines = [
		"# Wikivoyage Research Index",
		"",
		"Destination guides fetched from Wikivoyage. Each file contains the full article with all sections, listings, coordinates, contact details, and descriptions.",
		"",
		"## Articles",
		"",
		"| File | Destination | Sections | Listings |",
		"|------|-------------|----------|----------|",
	];

	for (const a of articles) {
		lines.push(`| [${a.slug}.md](${a.slug}.md) | ${a.title} | ${a.sectionCount} | ${a.listingCount} |`);
	}

	lines.push(
		"",
		"## How to read these files",
		"",
		"Each article file contains:",
		"- **Narrative sections** (Understand, Get in, Get around, etc.) — prose text about the destination",
		"- **Listings** — structured entries for places, restaurants, hotels, etc. with:",
		"  - Coordinates (lat, long) for mapping",
		"  - Contact details (phone, email, url)",
		"  - Practical info (hours, price, directions)",
		"  - Description from Wikivoyage contributors",
		"",
		"Listings appear under their parent section as bullet points with metadata on the second line.",
		"",
		"## Fetching more articles",
		"",
		"```bash",
		"npm run vault fetch-wikivoyage <trip> <destination1> [destination2] ...",
		"```",
	);

	return frontmatter + "\n\n" + lines.join("\n") + "\n";
}
