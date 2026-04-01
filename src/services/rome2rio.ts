/**
 * Rome2Rio integration — multi-modal transport search.
 *
 * Answers "how do I get from A to B?" with all ground/water transport options:
 * trains, buses, ferries, driving, and combinations — with durations and
 * indicative prices.
 *
 * Uses the free API at free.rome2rio.com/api/1.4/json/Search.
 * See docs/api-research.md for context on how this fits the planning workflow.
 */

// ---------------------------------------------------------------------------
// Types — public
// ---------------------------------------------------------------------------

export interface SearchTransportOptions {
	/** Origin name (e.g. "Siena") */
	originName: string;
	/** Destination name (e.g. "San Gimignano") */
	destinationName: string;
	/** Origin coordinates — more precise than name alone */
	originPos?: { lat: number; lng: number };
	/** Destination coordinates */
	destinationPos?: { lat: number; lng: number };
	/** ISO 4217 currency code for prices (default USD) */
	currency?: string;
	/** Exclude transport modes */
	exclude?: TransportExclusion[];
}

export type TransportExclusion =
	| "flights"
	| "trains"
	| "buses"
	| "ferries"
	| "cars"
	| "rideshare";

export interface TransportRoute {
	/** Human-readable route name, e.g. "Train" or "Bus, train" */
	name: string;
	/** Total distance in km */
	distanceKm: number;
	/** Total duration in minutes */
	durationMinutes: number;
	/** Stops along the route */
	stops: TransportStop[];
	/** Individual segments (legs) of the journey */
	segments: TransportSegment[];
}

export interface TransportStop {
	name: string;
	pos?: { lat: number; lng: number };
	kind?: string;
}

export interface TransportSegment {
	/** walk, car, train, bus, ferry */
	kind: string;
	/** More specific: e.g. "regional", "highspeed", "local" */
	subkind?: string;
	/** Whether this is the main segment of the route */
	isMajor: boolean;
	/** Distance in km */
	distanceKm: number;
	/** Duration in minutes */
	durationMinutes: number;
	/** Departure point */
	from: string;
	/** Arrival point */
	to: string;
	/** Indicative price (not live — Rome2Rio doesn't provide real-time pricing) */
	price?: TransportPrice;
	/** Operating agency/company name */
	agency?: string;
	/** Booking or info URL */
	url?: string;
	/** Service frequency in minutes (how often it runs) */
	frequencyMinutes?: number;
	/** Line/service names (e.g. "FR 9627", "Eurostar") */
	lines?: string[];
}

export interface TransportPrice {
	/** Price in requested currency */
	low?: number;
	high?: number;
	currency: string;
	/** Price in the local currency */
	nativeLow?: number;
	nativeHigh?: number;
	nativeCurrency?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = "https://free.rome2rio.com/api/1.4/json/Search";

function getApiKey(): string {
	const key = process.env.ROME2RIO_API_KEY;
	if (!key) throw new Error("ROME2RIO_API_KEY is not set");
	return key;
}

const EXCLUSION_PARAMS: Record<TransportExclusion, string> = {
	flights: "noAir",
	trains: "noRail",
	buses: "noBus",
	ferries: "noFerry",
	cars: "noCar",
	rideshare: "noRideshare",
};

// ---------------------------------------------------------------------------
// API function
// ---------------------------------------------------------------------------

/**
 * Search for transport options between two locations.
 *
 * Returns all ground/water routes Rome2Rio knows about — trains, buses,
 * ferries, driving, and multi-modal combinations. Flight results are excluded
 * by default (flights are out of scope for trip planning).
 */
export async function searchTransport(
	options: SearchTransportOptions,
): Promise<TransportRoute[]> {
	const {
		originName,
		destinationName,
		originPos,
		destinationPos,
		currency,
		exclude = ["flights", "rideshare"],
	} = options;

	const params = new URLSearchParams();
	params.set("key", getApiKey());
	params.set("oName", originName);
	params.set("dName", destinationName);

	if (originPos) params.set("oPos", `${originPos.lat},${originPos.lng}`);
	if (destinationPos) params.set("dPos", `${destinationPos.lat},${destinationPos.lng}`);
	if (currency) params.set("currencyCode", currency);

	for (const ex of exclude) {
		params.set(EXCLUSION_PARAMS[ex], "");
	}

	const res = await fetch(`${API_BASE}?${params.toString()}`, {
		headers: { Accept: "application/json" },
	});

	if (!res.ok) {
		const error = await res.text();
		throw new Error(`Rome2Rio search failed (${res.status}): ${error}`);
	}

	const data = (await res.json()) as RawSearchResponse;
	return mapRoutes(data);
}

// ---------------------------------------------------------------------------
// Raw API shapes (internal)
// ---------------------------------------------------------------------------

interface RawSearchResponse {
	agencies?: RawAgency[];
	routes?: RawRoute[];
}

interface RawAgency {
	code?: string;
	name?: string;
	url?: string;
}

interface RawRoute {
	name?: string;
	distance?: number;
	duration?: number;
	stops?: RawStop[];
	segments?: RawSegment[];
}

interface RawStop {
	name?: string;
	pos?: string; // "lat,lng"
	kind?: string;
}

interface RawSegment {
	kind?: string;
	subkind?: string;
	isMajor?: number; // 0 or 1
	distance?: number;
	duration?: number;
	sName?: string;
	tName?: string;
	sPos?: string;
	tPos?: string;
	indicativePrice?: RawIndicativePrice;
	itineraries?: RawTransitItinerary[];
	agencies?: number[]; // indexes into top-level agencies array
}

interface RawIndicativePrice {
	price?: number;
	priceLow?: number;
	priceHigh?: number;
	currency?: string;
	nativePrice?: number;
	nativePriceLow?: number;
	nativePriceHigh?: number;
	nativeCurrency?: string;
	isFreeTransfer?: number;
}

interface RawTransitItinerary {
	legs?: RawTransitLeg[];
}

interface RawTransitLeg {
	url?: string;
	hops?: RawTransitHop[];
}

interface RawTransitHop {
	sName?: string;
	tName?: string;
	frequency?: number;
	duration?: number;
	lines?: RawTransitLine[];
}

interface RawTransitLine {
	name?: string;
	vehicle?: string;
	agency?: number; // index into agencies
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function parsePos(pos: string | undefined): { lat: number; lng: number } | undefined {
	if (!pos) return undefined;
	const [lat, lng] = pos.split(",").map(Number);
	if (Number.isNaN(lat) || Number.isNaN(lng)) return undefined;
	return { lat, lng };
}

function mapRoutes(data: RawSearchResponse): TransportRoute[] {
	const agencies = data.agencies ?? [];

	return (data.routes ?? []).map((route) => ({
		name: route.name ?? "",
		distanceKm: route.distance ?? 0,
		durationMinutes: route.duration ?? 0,
		stops: (route.stops ?? []).map(mapStop),
		segments: (route.segments ?? []).map((seg) => mapSegment(seg, agencies)),
	}));
}

function mapStop(raw: RawStop): TransportStop {
	return {
		name: raw.name ?? "",
		pos: parsePos(raw.pos),
		kind: raw.kind,
	};
}

function mapSegment(raw: RawSegment, agencies: RawAgency[]): TransportSegment {
	const segment: TransportSegment = {
		kind: raw.kind ?? "unknown",
		subkind: raw.subkind,
		isMajor: raw.isMajor === 1,
		distanceKm: raw.distance ?? 0,
		durationMinutes: raw.duration ?? 0,
		from: raw.sName ?? "",
		to: raw.tName ?? "",
	};

	// Price
	if (raw.indicativePrice && raw.indicativePrice.isFreeTransfer !== 1) {
		const p = raw.indicativePrice;
		segment.price = {
			low: p.priceLow ?? p.price,
			high: p.priceHigh ?? p.price,
			currency: p.currency ?? "USD",
			nativeLow: p.nativePriceLow ?? p.nativePrice,
			nativeHigh: p.nativePriceHigh ?? p.nativePrice,
			nativeCurrency: p.nativeCurrency,
		};
	}

	// Agency — pick the first referenced agency
	if (raw.agencies?.length && agencies.length) {
		const agencyIdx = raw.agencies[0];
		const agency = agencies[agencyIdx];
		if (agency) {
			segment.agency = agency.name;
			segment.url = agency.url;
		}
	}

	// Transit details — extract frequency and line names from itineraries
	if (raw.itineraries?.length) {
		const lines: string[] = [];
		let minFrequency: number | undefined;

		for (const itinerary of raw.itineraries) {
			for (const leg of itinerary.legs ?? []) {
				if (!segment.url && leg.url) segment.url = leg.url;
				for (const hop of leg.hops ?? []) {
					if (hop.frequency && (!minFrequency || hop.frequency < minFrequency)) {
						minFrequency = hop.frequency;
					}
					for (const line of hop.lines ?? []) {
						if (line.name && !lines.includes(line.name)) {
							lines.push(line.name);
						}
						// Agency from line if not already set
						if (!segment.agency && line.agency !== undefined && agencies[line.agency]) {
							segment.agency = agencies[line.agency].name;
							segment.url = segment.url ?? agencies[line.agency].url;
						}
					}
				}
			}
		}

		if (lines.length) segment.lines = lines;
		if (minFrequency) segment.frequencyMinutes = minFrequency;
	}

	return segment;
}
