import { describe, expect, it, vi } from "vitest";
import { parseListing, parseSections, getListingsBySection, getListingsUnder, getSummary } from "./wikivoyage.js";
import type { WikivoyageArticle } from "./wikivoyage.js";

describe("parseListing", () => {
  it("parses a full listing template", () => {
    const body = `name=Sagrada Família|alt=Temple Expiatori|url=https://sagradafamilia.org|lat=41.4036|long=2.1744|directions=Metro L2/L5 Sagrada Família|phone=+34 932 080 414|hours=Mon-Sat 9AM-8PM|price=€26|content=Gaudí's masterpiece, still under construction since 1882.`;
    const listing = parseListing("see", body);

    expect(listing.type).toBe("see");
    expect(listing.name).toBe("Sagrada Família");
    expect(listing.alt).toBe("Temple Expiatori");
    expect(listing.url).toBe("https://sagradafamilia.org");
    expect(listing.lat).toBeCloseTo(41.4036);
    expect(listing.long).toBeCloseTo(2.1744);
    expect(listing.directions).toBe("Metro L2/L5 Sagrada Família");
    expect(listing.phone).toBe("+34 932 080 414");
    expect(listing.hours).toBe("Mon-Sat 9AM-8PM");
    expect(listing.price).toBe("€26");
    expect(listing.description).toBe("Gaudí's masterpiece, still under construction since 1882.");
  });

  it("handles minimal listing with just a name", () => {
    const listing = parseListing("eat", "name=Cal Pep");
    expect(listing.name).toBe("Cal Pep");
    expect(listing.type).toBe("eat");
    expect(listing.lat).toBeUndefined();
  });

  it("strips wikitext markup from description", () => {
    const listing = parseListing("see", "name=Test|content=Visit the [[Gothic Quarter|Barri Gòtic]] for '''amazing''' views.");
    expect(listing.description).toBe("Visit the Barri Gòtic for amazing views.");
  });

  it("handles nested templates in params without breaking", () => {
    const listing = parseListing("do", "name=City Tour|content=See {{icon|star}} highlights|price=Free");
    expect(listing.name).toBe("City Tour");
    expect(listing.price).toBe("Free");
  });

  it("parses marker template with type param", () => {
    const listing = parseListing("marker", "type=see|name=Botanical Gardens|lat=51.3879|long=-2.3764");
    expect(listing.type).toBe("see");
    expect(listing.name).toBe("Botanical Gardens");
    expect(listing.lat).toBeCloseTo(51.3879);
  });

  it("parses generic listing template with type param", () => {
    const listing = parseListing("listing", "type=go|name=First West England|url=https://example.com");
    expect(listing.type).toBe("go");
    expect(listing.name).toBe("First West England");
    expect(listing.url).toBe("https://example.com");
  });

  it("defaults to listing type for marker without type param", () => {
    const listing = parseListing("marker", "name=Bathampton|lat=51.40061|long=-2.32619");
    expect(listing.type).toBe("listing");
    expect(listing.name).toBe("Bathampton");
  });

  it("parses capitalized template names", () => {
    const listing = parseListing("Eat", "name=The Mad Hatter|phone=+44 1225 571314|hours=10AM-6PM|content=Popular tea room.");
    expect(listing.type).toBe("eat");
    expect(listing.name).toBe("The Mad Hatter");
    expect(listing.hours).toBe("10AM-6PM");
  });

  it("uses address as fallback for directions", () => {
    const listing = parseListing("eat", "name=Cafe|address=5 Orange Grove, Bath BA1 1LP");
    expect(listing.directions).toBe("5 Orange Grove, Bath BA1 1LP");
  });
});

describe("parseSections", () => {
  const sampleWikitext = `
Some intro text about the city.

== Understand ==

Barcelona is the capital of Catalonia.

== See ==

The city has remarkable architecture.

* {{see|name=Sagrada Família|lat=41.4036|long=2.1744|content=Gaudí's masterpiece.}}
* {{see|name=Park Güell|lat=41.4145|long=2.1527|price=€10|content=Gaudí's public park.}}

=== Gothic Quarter ===

The oldest part of the city.

* {{see|name=Barcelona Cathedral|content=14th century cathedral.}}

== Do ==

* {{do|name=Las Ramblas Walk|content=Stroll down the famous boulevard.}}

== Eat ==

* {{eat|name=Cal Pep|price=€€€|hours=Mon-Sat 13:00-15:30|content=Legendary tapas bar.}}
* {{eat|name=La Boqueria|price=€-€€|content=Iconic food market on Las Ramblas.}}
`.trim();

  it("parses intro section", () => {
    const sections = parseSections(sampleWikitext);
    expect(sections[0].title).toBe("Introduction");
    expect(sections[0].content).toContain("intro text");
  });

  it("extracts all top-level sections", () => {
    const sections = parseSections(sampleWikitext);
    const titles = sections.map((s) => s.title);
    expect(titles).toContain("Understand");
    expect(titles).toContain("See");
    expect(titles).toContain("Do");
    expect(titles).toContain("Eat");
  });

  it("extracts subsections with correct level", () => {
    const sections = parseSections(sampleWikitext);
    const gothic = sections.find((s) => s.title === "Gothic Quarter");
    expect(gothic).toBeDefined();
    expect(gothic!.level).toBe(3);
  });

  it("extracts listings from sections", () => {
    const sections = parseSections(sampleWikitext);
    const see = sections.find((s) => s.title === "See");
    expect(see?.listings).toHaveLength(2);
    expect(see?.listings[0].name).toBe("Sagrada Família");
    expect(see?.listings[1].name).toBe("Park Güell");
  });

  it("extracts listings from subsections", () => {
    const sections = parseSections(sampleWikitext);
    const gothic = sections.find((s) => s.title === "Gothic Quarter");
    expect(gothic?.listings).toHaveLength(1);
    expect(gothic?.listings[0].name).toBe("Barcelona Cathedral");
  });

  it("extracts eat listings with price and hours", () => {
    const sections = parseSections(sampleWikitext);
    const eat = sections.find((s) => s.title === "Eat");
    expect(eat?.listings).toHaveLength(2);
    expect(eat?.listings[0].price).toBe("€€€");
    expect(eat?.listings[0].hours).toBe("Mon-Sat 13:00-15:30");
  });

  it("extracts marker templates", () => {
    const wikitext = `== See ==
* {{marker|type=see|name=Botanical Gardens|lat=51.3879|long=-2.3764}}
* {{marker|type=see|name=Roman Baths|lat=51.381|long=-2.359}}`;
    const sections = parseSections(wikitext);
    const see = sections.find((s) => s.title === "See");
    expect(see?.listings).toHaveLength(2);
    expect(see?.listings[0].name).toBe("Botanical Gardens");
    expect(see?.listings[0].type).toBe("see");
  });

  it("extracts capitalized template names", () => {
    const wikitext = `== Eat ==
* {{Eat|name=The Mad Hatter|hours=10AM-6PM|content=Popular tea room.}}`;
    const sections = parseSections(wikitext);
    const eat = sections.find((s) => s.title === "Eat");
    expect(eat?.listings).toHaveLength(1);
    expect(eat?.listings[0].type).toBe("eat");
  });
});

describe("getListingsBySection", () => {
  const article: WikivoyageArticle = {
    title: "Barcelona",
    pageId: 123,
    raw: "",
    sections: [
      { title: "See", level: 2, content: "", listings: [
        { type: "see", name: "Sagrada Família" },
        { type: "see", name: "Park Güell" },
      ]},
      { title: "Eat", level: 2, content: "", listings: [
        { type: "eat", name: "Cal Pep" },
      ]},
      { title: "Do", level: 2, content: "", listings: [
        { type: "do", name: "Las Ramblas Walk" },
      ]},
    ],
  };

  it("returns listings for a single section", () => {
    const listings = getListingsBySection(article, "See");
    expect(listings).toHaveLength(2);
  });

  it("returns listings for multiple sections", () => {
    const listings = getListingsBySection(article, "See", "Do");
    expect(listings).toHaveLength(3);
  });

  it("is case-insensitive", () => {
    const listings = getListingsBySection(article, "see", "EAT");
    expect(listings).toHaveLength(3);
  });

  it("returns empty for non-existent section", () => {
    const listings = getListingsBySection(article, "Sleep");
    expect(listings).toHaveLength(0);
  });
});

describe("getListingsUnder", () => {
  const article: WikivoyageArticle = {
    title: "Bath",
    pageId: 456,
    raw: "",
    sections: [
      { title: "See", level: 2, content: "", listings: [
        { type: "see", name: "Roman Baths" },
      ]},
      { title: "Landmarks", level: 3, content: "", listings: [
        { type: "see", name: "Abbey" },
        { type: "see", name: "Pulteney Bridge" },
      ]},
      { title: "Museums", level: 3, content: "", listings: [
        { type: "see", name: "Fashion Museum" },
      ]},
      { title: "Do", level: 2, content: "", listings: [
        { type: "do", name: "Walking Tour" },
      ]},
      { title: "Sports", level: 3, content: "", listings: [
        { type: "do", name: "Rugby" },
      ]},
      { title: "Eat", level: 2, content: "", listings: [] },
    ],
  };

  it("collects listings from parent and all subsections", () => {
    const listings = getListingsUnder(article, "See");
    expect(listings).toHaveLength(4);
    expect(listings.map((l) => l.name)).toEqual([
      "Roman Baths", "Abbey", "Pulteney Bridge", "Fashion Museum",
    ]);
  });

  it("stops at next sibling section", () => {
    const listings = getListingsUnder(article, "Do");
    expect(listings).toHaveLength(2);
    expect(listings.map((l) => l.name)).toEqual(["Walking Tour", "Rugby"]);
  });

  it("returns empty for section with no listings in tree", () => {
    const listings = getListingsUnder(article, "Eat");
    expect(listings).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const listings = getListingsUnder(article, "see");
    expect(listings).toHaveLength(4);
  });
});

describe("getSummary", () => {
  const article: WikivoyageArticle = {
    title: "Barcelona",
    pageId: 123,
    raw: "",
    sections: [
      { title: "Introduction", level: 1, content: "Barcelona is great.", listings: [] },
      { title: "Understand", level: 2, content: "Capital of Catalonia.", listings: [] },
      { title: "Get in", level: 2, content: "Fly to El Prat airport.", listings: [] },
      { title: "Get around", level: 2, content: "Metro is excellent.", listings: [] },
      { title: "See", level: 2, content: "Architecture everywhere.", listings: [
        { type: "see", name: "Sagrada Família" },
      ]},
      { title: "Eat", level: 2, content: "Tapas and seafood.", listings: [] },
    ],
  };

  it("includes key sections", () => {
    const summary = getSummary(article);
    expect(summary).toContain("# Barcelona");
    expect(summary).toContain("## Introduction");
    expect(summary).toContain("## Understand");
    expect(summary).toContain("## Get in");
    expect(summary).toContain("## Get around");
  });

  it("excludes non-key sections", () => {
    const summary = getSummary(article);
    expect(summary).not.toContain("## See");
    expect(summary).not.toContain("## Eat");
  });
});
