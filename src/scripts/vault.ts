#!/usr/bin/env tsx

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TRIPS_DIR = join(ROOT, "trips");
const TEMPLATES_DIR = join(__dirname, "../templates");

// --- Template helpers ---

function readTemplate(name: string): string {
	const path = join(TEMPLATES_DIR, `${name}.md`);
	if (!existsSync(path)) {
		console.error(`Template not found: ${name}`);
		process.exit(1);
	}
	return readFileSync(path, "utf-8");
}

function fillTemplate(template: string, vars: Record<string, string>): string {
	let result = template;
	for (const [key, value] of Object.entries(vars)) {
		result = result.replaceAll(`{{${key}}}`, value);
	}
	return result;
}

function writeFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	if (existsSync(path)) {
		console.error(`Already exists: ${path}`);
		process.exit(1);
	}
	writeFileSync(path, content);
	console.log(`Created: ${path.replace(ROOT + "/", "")}`);
}

function tripDir(tripName: string): string {
	const dir = join(TRIPS_DIR, tripName);
	if (!existsSync(dir)) {
		console.error(`Trip not found: ${tripName}`);
		console.error(`Available trips: ${listTripNames().join(", ") || "(none)"}`);
		process.exit(1);
	}
	return dir;
}

function listTripNames(): string[] {
	if (!existsSync(TRIPS_DIR)) return [];
	return readdirSync(TRIPS_DIR).filter((f) => {
		const full = join(TRIPS_DIR, f);
		return statSync(full).isDirectory();
	});
}

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

// --- Commands ---

function createTrip(name: string): void {
	const slug = slugify(name);
	const dir = join(TRIPS_DIR, slug);

	if (existsSync(dir)) {
		console.error(`Trip already exists: ${slug}`);
		process.exit(1);
	}

	mkdirSync(dir, { recursive: true });

	// Scaffold folders
	for (const sub of ["travelers", "places", "logistics", "itinerary", "research", "docs", "attachments"]) {
		mkdirSync(join(dir, sub), { recursive: true });
	}

	// Create trip.md
	const tripContent = fillTemplate(readTemplate("trip"), { name });
	writeFile(join(dir, "trip.md"), tripContent);

	// Create budget.md
	writeFile(join(dir, "logistics/budget.md"), readTemplate("budget"));

	// Create decisions.md
	const decisionsContent = fillTemplate(readTemplate("decisions"), { trip: name });
	writeFile(join(dir, "decisions.md"), decisionsContent);

	console.log(`\nTrip "${name}" created at trips/${slug}/`);
}

function addEntity(tripName: string, entityType: string, entityName: string): void {
	const dir = tripDir(tripName);
	const slug = slugify(entityName);

	const entityMap: Record<string, { template: string; path: string }> = {
		traveler: { template: "traveler", path: `travelers/${slug}.md` },
		place: { template: "place", path: `places/${slug}.md` },
		accommodation: { template: "accommodation", path: `logistics/accommodation-${slug}.md` },
		transport: { template: "transport", path: `logistics/transport-${slug}.md` },
		day: { template: "day", path: `itinerary/day-${entityName}.md` },
		research: { template: "research", path: `research/${slug}.md` },
		attachment: { template: "attachment", path: `attachments/${slug}.md` },
	};

	const entity = entityMap[entityType];
	if (!entity) {
		console.error(`Unknown entity type: ${entityType}`);
		console.error(`Available types: ${Object.keys(entityMap).join(", ")}`);
		process.exit(1);
	}

	const vars: Record<string, string> = { name: entityName };
	if (entityType === "day") {
		vars["day"] = entityName;
		vars["title"] = "";
	}
	if (entityType === "research") {
		vars["topic"] = entityName;
	}

	const content = fillTemplate(readTemplate(entity.template), vars);
	writeFile(join(dir, entity.path), content);
}

function listTrips(): void {
	const trips = listTripNames();
	if (trips.length === 0) {
		console.log("No trips yet. Create one with: npm run vault create-trip <name>");
		return;
	}

	for (const name of trips) {
		const tripFile = join(TRIPS_DIR, name, "trip.md");
		if (existsSync(tripFile)) {
			const content = readFileSync(tripFile, "utf-8");
			const statusMatch = content.match(/^status:\s*(.+)$/m);
			const status = statusMatch?.[1] ?? "unknown";
			const travelersDir = join(TRIPS_DIR, name, "travelers");
			const travelers = existsSync(travelersDir)
				? readdirSync(travelersDir).filter((f) => f.endsWith(".md")).length
				: 0;
			console.log(`  ${name}  [${status}]  ${travelers} traveler(s)`);
		} else {
			console.log(`  ${name}  (no trip.md)`);
		}
	}
}

function showTrip(tripName: string): void {
	const dir = tripDir(tripName);

	function tree(path: string, prefix: string = ""): void {
		const entries = readdirSync(path).sort();
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			const full = join(path, entry);
			const isLast = i === entries.length - 1;
			const connector = isLast ? "└── " : "├── ";
			console.log(`${prefix}${connector}${entry}`);
			if (statSync(full).isDirectory()) {
				tree(full, prefix + (isLast ? "    " : "│   "));
			}
		}
	}

	console.log(`trips/${tripName}/`);
	tree(dir);
}

// --- CLI ---

const USAGE = `Usage:
  npm run vault create-trip <name>
  npm run vault add <trip> <type> <name>
  npm run vault list
  npm run vault show <trip>

Entity types: traveler, place, accommodation, transport, day, research, attachment`;

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
	case "create-trip": {
		const name = args.slice(1).join(" ");
		if (!name) {
			console.error("Usage: npm run vault create-trip <name>");
			process.exit(1);
		}
		createTrip(name);
		break;
	}
	case "add": {
		const [trip, type, ...rest] = args.slice(1);
		const name = rest.join(" ");
		if (!trip || !type || !name) {
			console.error("Usage: npm run vault add <trip> <type> <name>");
			process.exit(1);
		}
		addEntity(trip, type, name);
		break;
	}
	case "list": {
		listTrips();
		break;
	}
	case "show": {
		const trip = args[1];
		if (!trip) {
			console.error("Usage: npm run vault show <trip>");
			process.exit(1);
		}
		showTrip(trip);
		break;
	}
	default: {
		console.log(USAGE);
		process.exit(command ? 1 : 0);
	}
}
