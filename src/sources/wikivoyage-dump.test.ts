import { describe, expect, it } from "vitest";
import { articleToMarkdown, buildIndex } from "./wikivoyage-dump.js";
import type { WikivoyageArticle } from "./wikivoyage.js";

const article: WikivoyageArticle = {
	title: "Stow-on-the-Wold",
	pageId: 12345,
	raw: "",
	sections: [
		{
			title: "Introduction",
			level: 1,
			content: "Stow-on-the-Wold is a small market town in the Cotswolds.",
			listings: [],
		},
		{
			title: "See",
			level: 2,
			content: "The town has a charming market square.",
			listings: [
				{
					type: "see",
					name: "St Edward's Church",
					lat: 51.93,
					long: -1.724,
					url: "scats.org.uk",
					description: "Medieval church with interesting doorway flanked by yew trees.",
				},
				{
					type: "see",
					name: "Fosse Art Gallery",
					lat: 51.93114,
					long: -1.72343,
					phone: "+44 1451 831319",
					url: "fossegallery.com",
					directions: "The Manor House, Market Square",
				},
			],
		},
		{
			title: "Eat",
			level: 2,
			content: "",
			listings: [
				{
					type: "eat",
					name: "Old Butchers",
					lat: 51.92896,
					long: -1.7201,
					phone: "+44 1451 831700",
					url: "theoldbutchers.com",
					hours: "M-F noon-2:30PM & 6:30-9:20PM",
					price: "£15-25",
					description: "Intimate restaurant in a former butcher's shop. Excellent local produce.",
				},
			],
		},
		{
			title: "Budget",
			level: 3,
			content: "",
			listings: [
				{
					type: "eat",
					name: "Cotswold Baguettes",
					lat: 51.92921,
					long: -1.72381,
					phone: "+44 1451 831362",
					url: "cotswoldbaguettes.co.uk",
				},
			],
		},
	],
};

describe("articleToMarkdown", () => {
	const md = articleToMarkdown(article, "2026-04-01");

	it("includes frontmatter with title and metadata", () => {
		expect(md).toContain('title: "Stow-on-the-Wold"');
		expect(md).toContain("page_id: 12345");
		expect(md).toContain("source: wikivoyage");
		expect(md).toContain('fetched: "2026-04-01"');
		expect(md).toContain("en.wikivoyage.org/wiki/Stow-on-the-Wold");
	});

	it("includes section narrative text", () => {
		expect(md).toContain("Stow-on-the-Wold is a small market town");
		expect(md).toContain("The town has a charming market square.");
	});

	it("preserves full listing fields", () => {
		expect(md).toContain("**St Edward's Church**");
		expect(md).toContain("coords: 51.93, -1.724");
		expect(md).toContain("url: scats.org.uk");
		expect(md).toContain("Medieval church with interesting doorway flanked by yew trees.");
	});

	it("preserves precise coordinates", () => {
		expect(md).toContain("coords: 51.93114, -1.72343");
	});

	it("preserves phone, hours, price, directions", () => {
		expect(md).toContain("phone: +44 1451 831319");
		expect(md).toContain("directions: The Manor House, Market Square");
		expect(md).toContain("hours: M-F noon-2:30PM & 6:30-9:20PM");
		expect(md).toContain("price: £15-25");
	});

	it("renders subsections with correct heading depth", () => {
		expect(md).toContain("### Budget");
	});

	it("includes all listings including subsections", () => {
		expect(md).toContain("**Old Butchers**");
		expect(md).toContain("**Cotswold Baguettes**");
	});
});

describe("buildIndex", () => {
	const index = buildIndex(
		[
			{ title: "Cotswolds", slug: "cotswolds", sectionCount: 15, listingCount: 2 },
			{ title: "Stow-on-the-Wold", slug: "stow-on-the-wold", sectionCount: 20, listingCount: 30 },
		],
		"2026-04-01",
	);

	it("lists all articles with file links", () => {
		expect(index).toContain("[cotswolds.md](cotswolds.md)");
		expect(index).toContain("[stow-on-the-wold.md](stow-on-the-wold.md)");
	});

	it("shows counts", () => {
		expect(index).toContain("| 15 | 2 |");
		expect(index).toContain("| 20 | 30 |");
	});

	it("includes usage instructions", () => {
		expect(index).toContain("npm run vault fetch-wikivoyage");
	});
});
