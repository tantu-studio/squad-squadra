import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchTransport } from "./rome2rio.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
	mockFetch.mockReset();
	vi.stubEnv("ROME2RIO_API_KEY", "test-key");
	vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	} as Response;
}

// Realistic response based on Rome2Rio API structure
const ROME_TO_FLORENCE = {
	agencies: [
		{ code: "Trenitalia", name: "Trenitalia", url: "https://www.trenitalia.com" },
		{ code: "FlixBus", name: "FlixBus", url: "https://www.flixbus.com" },
	],
	routes: [
		{
			name: "Train",
			distance: 274,
			duration: 95,
			stops: [
				{ name: "Roma Termini", pos: "41.9006,12.5019", kind: "station" },
				{ name: "Firenze S.M.N.", pos: "43.7764,11.2484", kind: "station" },
			],
			segments: [
				{
					kind: "train",
					subkind: "highspeed",
					isMajor: 1,
					distance: 274,
					duration: 95,
					sName: "Roma Termini",
					sPos: "41.9006,12.5019",
					tName: "Firenze S.M.N.",
					tPos: "43.7764,11.2484",
					agencies: [0],
					indicativePrice: {
						priceLow: 19,
						priceHigh: 50,
						currency: "EUR",
						nativePriceLow: 19,
						nativePriceHigh: 50,
						nativeCurrency: "EUR",
					},
					itineraries: [
						{
							legs: [
								{
									url: "https://www.trenitalia.com/en.html",
									hops: [
										{
											sName: "Roma Termini",
											tName: "Firenze S.M.N.",
											frequency: 30,
											duration: 95,
											lines: [
												{ name: "Frecciarossa", vehicle: "train", agency: 0 },
											],
										},
									],
								},
							],
						},
					],
				},
			],
		},
		{
			name: "Bus",
			distance: 280,
			duration: 180,
			stops: [
				{ name: "Rome", pos: "41.9028,12.4964", kind: "city" },
				{ name: "Florence", pos: "43.7696,11.2558", kind: "city" },
			],
			segments: [
				{
					kind: "bus",
					isMajor: 1,
					distance: 280,
					duration: 180,
					sName: "Rome",
					tName: "Florence",
					agencies: [1],
					indicativePrice: {
						priceLow: 9,
						priceHigh: 25,
						currency: "EUR",
					},
					itineraries: [
						{
							legs: [
								{
									hops: [
										{
											sName: "Rome",
											tName: "Florence",
											frequency: 60,
											duration: 180,
											lines: [
												{ name: "FlixBus", vehicle: "bus", agency: 1 },
											],
										},
									],
								},
							],
						},
					],
				},
			],
		},
	],
};

// ---------------------------------------------------------------------------
// searchTransport
// ---------------------------------------------------------------------------

describe("searchTransport", () => {
	it("sends correct request params", async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse(ROME_TO_FLORENCE));

		await searchTransport({
			originName: "Rome",
			destinationName: "Florence",
		});

		const [url] = mockFetch.mock.calls[0];
		expect(url).toContain("oName=Rome");
		expect(url).toContain("dName=Florence");
		expect(url).toContain("key=test-key");
		// Default exclusions
		expect(url).toContain("noAir=");
		expect(url).toContain("noRideshare=");
	});

	it("maps routes from API response", async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse(ROME_TO_FLORENCE));

		const routes = await searchTransport({
			originName: "Rome",
			destinationName: "Florence",
		});

		expect(routes).toHaveLength(2);

		// Train route
		const train = routes[0];
		expect(train.name).toBe("Train");
		expect(train.distanceKm).toBe(274);
		expect(train.durationMinutes).toBe(95);
		expect(train.stops).toHaveLength(2);
		expect(train.stops[0].name).toBe("Roma Termini");
		expect(train.stops[0].pos).toEqual({ lat: 41.9006, lng: 12.5019 });

		// Train segment
		expect(train.segments).toHaveLength(1);
		const seg = train.segments[0];
		expect(seg.kind).toBe("train");
		expect(seg.subkind).toBe("highspeed");
		expect(seg.isMajor).toBe(true);
		expect(seg.from).toBe("Roma Termini");
		expect(seg.to).toBe("Firenze S.M.N.");
		expect(seg.agency).toBe("Trenitalia");
		expect(seg.lines).toEqual(["Frecciarossa"]);
		expect(seg.frequencyMinutes).toBe(30);

		// Price
		expect(seg.price).toEqual({
			low: 19,
			high: 50,
			currency: "EUR",
			nativeLow: 19,
			nativeHigh: 50,
			nativeCurrency: "EUR",
		});

		// Bus route
		const bus = routes[1];
		expect(bus.name).toBe("Bus");
		expect(bus.durationMinutes).toBe(180);
		expect(bus.segments[0].agency).toBe("FlixBus");
	});

	it("passes coordinates when provided", async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({ routes: [] }));

		await searchTransport({
			originName: "Siena",
			destinationName: "San Gimignano",
			originPos: { lat: 43.318, lng: 11.331 },
			destinationPos: { lat: 43.468, lng: 11.043 },
			currency: "EUR",
		});

		const [url] = mockFetch.mock.calls[0];
		expect(url).toContain("oPos=43.318%2C11.331");
		expect(url).toContain("dPos=43.468%2C11.043");
		expect(url).toContain("currencyCode=EUR");
	});

	it("applies custom exclusions", async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({ routes: [] }));

		await searchTransport({
			originName: "A",
			destinationName: "B",
			exclude: ["flights", "buses", "cars"],
		});

		const [url] = mockFetch.mock.calls[0];
		expect(url).toContain("noAir=");
		expect(url).toContain("noBus=");
		expect(url).toContain("noCar=");
		expect(url).not.toContain("noRail");
		expect(url).not.toContain("noFerry");
	});

	it("returns empty array when no routes found", async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({}));
		const routes = await searchTransport({
			originName: "Nowhere",
			destinationName: "Nowhere Else",
		});
		expect(routes).toEqual([]);
	});

	it("handles free transfers (no price)", async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({
				routes: [
					{
						name: "Walk",
						distance: 1.2,
						duration: 15,
						stops: [],
						segments: [
							{
								kind: "walk",
								isMajor: 1,
								distance: 1.2,
								duration: 15,
								sName: "Hotel",
								tName: "Station",
								indicativePrice: { isFreeTransfer: 1, currency: "EUR" },
							},
						],
					},
				],
			}),
		);

		const routes = await searchTransport({
			originName: "Hotel",
			destinationName: "Station",
		});

		expect(routes[0].segments[0].price).toBeUndefined();
	});

	it("throws on API error", async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Invalid key" }, 401));
		await expect(
			searchTransport({ originName: "A", destinationName: "B" }),
		).rejects.toThrow(/Rome2Rio search failed \(401\)/);
	});
});

// ---------------------------------------------------------------------------
// Missing API key
// ---------------------------------------------------------------------------

describe("missing API key", () => {
	it("throws when ROME2RIO_API_KEY is not set", async () => {
		vi.stubEnv("ROME2RIO_API_KEY", "");

		await expect(
			searchTransport({ originName: "A", destinationName: "B" }),
		).rejects.toThrow("ROME2RIO_API_KEY is not set");
	});
});
