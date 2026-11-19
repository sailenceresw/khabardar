import { describe, expect, it } from "vitest";
import {
  detectEmails,
  detectLeaks,
  detectNationalIds,
  detectPersonalNames,
  detectPersonalUrls,
  detectPhones,
  detectStreetAddresses,
  detectVehiclePlates,
  resolveOverlaps,
  type LeakFinding,
} from "@khabardar/shared";

/*
 * The detectors live in packages/shared. Their tests live here because this is
 * the suite CI runs, and the shared package has no test runner of its own.
 */

const spans = (found: LeakFinding[]) => found.map((f) => f.text);

describe("detectEmails", () => {
  it("flags ordinary and work addresses", () => {
    expect(spans(detectEmails("write to ram.thapa@gmail.com or r_thapa+1@ird.gov.np"))).toEqual([
      "ram.thapa@gmail.com",
      "r_thapa+1@ird.gov.np",
    ]);
  });

  it("records an exact span and a severity and reason", () => {
    const text = "Mail me: a.b@example.co.uk.";
    const [f] = detectEmails(text);
    expect(text.slice(f.start, f.end)).toBe("a.b@example.co.uk");
    expect(f.severity).toBe("high");
    expect(f.reason.length).toBeGreaterThan(10);
  });

  it("does not flag an @ that is not an address", () => {
    expect(detectEmails("Met @ 5pm at the office, rate was 3 @ 100")).toEqual([]);
  });
});

describe("detectPhones", () => {
  it.each([
    ["+977-9841234567"],
    ["+977 984 123 4567"],
    ["9779812345678"],
    ["9841234567"],
    ["986-1234567"],
    ["01-4412345"],
    ["+977-1-4412345"],
    ["07700 900123"],
    ["+44 7700 900123"],
    ["+44 (0)20 7946 0958"],
    ["020 7946 0958"],
    ["0161 496 0000"],
  ])("flags %s", (number) => {
    expect(spans(detectPhones(`call ${number} today`))).toEqual([number]);
  });

  it.each([
    ["a date", "The transfer happened on 2024-03-15 at 10.30."],
    ["an amount in lakhs", "They paid Rs 1,50,000 and later NPR 2500000."],
    ["a Bikram Sambat year", "This started in 2081 and is still going."],
    ["a citizenship number", "number 27-01-72-12345 was on the form"],
    ["a file number", "File no. 123/079-80 was never registered."],
  ])("does not flag %s", (_label, sentence) => {
    expect(detectPhones(sentence)).toEqual([]);
  });
});

describe("detectNationalIds", () => {
  it("flags the district-ward-year-serial citizenship shape", () => {
    expect(spans(detectNationalIds("certificate 27-01-72-12345 issued"))).toEqual(["27-01-72-12345"]);
  });

  it.each([
    ["my citizenship no. 123/4567 was copied", "123/4567"],
    ["Passport number: PA1234567", "PA1234567"],
    ["PAN 302456789 is registered to me", "302456789"],
    ["national ID card number is 123-456-789", "123-456-789"],
  ])("flags only the number in %j", (sentence, number) => {
    expect(spans(detectNationalIds(sentence))).toEqual([number]);
  });

  it("flags a UK National Insurance number", () => {
    expect(spans(detectNationalIds("my NI number is AB 12 34 56 C"))).toEqual(["AB 12 34 56 C"]);
    expect(spans(detectNationalIds("NINO JG123456A on file"))).toEqual(["JG123456A"]);
  });

  it("does not flag HMRC's never-issued example prefix QQ", () => {
    expect(detectNationalIds("example QQ 12 34 56 C")).toEqual([]);
  });

  it.each([
    ["an ID keyword with no number", "They asked for my passport and citizenship."],
    ["a word that only contains a keyword", "The Japan office sent 300 people."],
    ["a NINO prefix HMRC never issues", "code GB 12 34 56 A"],
    ["a ward number", "Ward No. 5 has 4000 households."],
  ])("does not flag %s", (_label, sentence) => {
    expect(detectNationalIds(sentence)).toEqual([]);
  });
});

describe("detectVehiclePlates", () => {
  it.each([
    ["Ba 2 Pa 1234"],
    ["ba 12 cha 3456"],
    ["Bagmati 01-002 Pa 1234"],
    ["Province 3-01-002 Cha 5678"],
    ["AB12 CDE"],
  ])("flags %s", (plate) => {
    const [f] = detectVehiclePlates(`the jeep ${plate} was outside`);
    expect(f.text).toBe(plate);
    expect(f.severity).toBe("medium");
  });

  it.each([
    ["ordinary words", "Ba and Pa went to the market with 12 bags."],
    ["a lower-case UK-like string", "ab12 cde is not a real plate in the text"],
    ["a model number", "the printer was an HP 1020"],
  ])("does not flag %s", (_label, sentence) => {
    expect(detectVehiclePlates(sentence)).toEqual([]);
  });
});

describe("detectPersonalUrls", () => {
  it.each([
    ["https://www.facebook.com/ram.thapa.77"],
    ["facebook.com/sunita.k"],
    ["instagram.com/hari_photos"],
    ["https://x.com/rthapa"],
    ["linkedin.com/in/sita-sharma"],
    ["tiktok.com/@kiran_vlogs"],
    ["wa.me/9779841234567"],
  ])("flags %s", (url) => {
    expect(spans(detectPersonalUrls(`see ${url} for proof`))).toEqual([url]);
  });

  it("flags a bare @handle but not an email", () => {
    expect(spans(detectPersonalUrls("DM me (@ram_thapa) or mail ram@thapa.com"))).toEqual(["@ram_thapa"]);
  });

  it.each([
    ["a Facebook group", "posted in facebook.com/groups/ktm-traders"],
    ["a share link", "https://www.facebook.com/sharer/sharer.php?u=x"],
    ["a government site", "see https://ciaa.gov.np/complaints"],
    ["a news site", "reported on https://kathmandupost.com/national"],
  ])("does not flag %s", (_label, sentence) => {
    expect(detectPersonalUrls(sentence)).toEqual([]);
  });
});

describe("detectStreetAddresses", () => {
  it.each([
    ["house no. 23", "medium"],
    ["H. No 45", "medium"],
    ["flat 3B", "medium"],
    ["12 Durbar Marg", "high"],
    ["221B Baker Street", "high"],
    ["NE1 8ST", "high"],
    ["SW1A 1AA", "high"],
  ])("flags %s", (address, severity) => {
    const [f] = detectStreetAddresses(`it was at ${address} last week`);
    expect(f.text).toBe(address);
    expect(f.severity).toBe(severity);
  });

  it.each([
    ["a ward", "It happened in Ward No. 5 of the municipality."],
    ["a coarse area", "They meet in New Baneshwor near the bus park."],
    ["a count of houses", "About 40 houses were demolished."],
    ["a road without a number", "The office is on Durbar Marg."],
    ["a lower-case postcode-like string", "reference ne1 8st in the ledger"],
  ])("does not flag %s", (_label, sentence) => {
    expect(detectStreetAddresses(sentence)).toEqual([]);
  });
});

describe("detectPersonalNames", () => {
  it.each([
    ["My name is Sunita Lama and I work there.", "Sunita Lama"],
    ["I told Hari Prasad Koirala about it.", "Hari Prasad Koirala"],
    ["Ram Bahadur Thapa signed the voucher.", "Ram Bahadur Thapa"],
    ["Sita saw the cash.", "Sita"],
    ["John Smith approved it.", "John Smith"],
    ["The officer, Mr. Adhikari, took the money.", "Mr. Adhikari"],
    ["Ask Shree Bikash about it.", "Shree Bikash"],
    ["Binod KC was there.", "Binod KC"],
  ])("flags the name in %j", (sentence, name) => {
    const found = detectLeaks(sentence).filter((f) => f.type === "personal-name");
    expect(spans(found)).toEqual([name]);
    expect(found[0].severity).toBe("medium");
  });

  it.each([
    ["a community name", "The Tamang community in the ward was not consulted."],
    ["a language", "The notice was printed in Nepali and English."],
    ["a word that is also a name", "Prem, they said, was the only reason."],
    ["a temple", "They met at Krishna Mandir on Tuesday."],
    ["a bank", "The money went through Laxmi Bank."],
    ["sentence-start words", "Yesterday The Office Manager refused."],
    ["a place", "The Kathmandu Metropolitan City office was closed."],
  ])("does not flag %s", (_label, sentence) => {
    expect(detectPersonalNames(sentence)).toEqual([]);
  });

  it("stops a name before an institution word", () => {
    expect(spans(detectPersonalNames("Sunita Bank staff"))).toEqual(["Sunita"]);
  });
});

describe("resolveOverlaps", () => {
  it("keeps the more severe finding where two overlap", () => {
    const found = detectLeaks("contact sunita.lama@gmail.com");
    expect(found.map((f) => f.type)).toEqual(["email"]);
  });

  it("prefers the longer span at equal severity", () => {
    const a: LeakFinding = { type: "personal-name", start: 0, end: 4, text: "Sita", severity: "medium", reason: "" };
    const b: LeakFinding = { type: "personal-name", start: 0, end: 10, text: "Sita Thapa", severity: "medium", reason: "" };
    expect(resolveOverlaps([a, b])).toEqual([b]);
  });

  it("keeps findings that touch but do not overlap", () => {
    const a: LeakFinding = { type: "email", start: 0, end: 5, text: "", severity: "high", reason: "" };
    const b: LeakFinding = { type: "phone", start: 5, end: 9, text: "", severity: "high", reason: "" };
    expect(resolveOverlaps([b, a])).toEqual([a, b]);
  });
});

describe("detectLeaks", () => {
  it("finds every kind of detail in one report, in order", () => {
    const text =
      "I am Sunita Lama, phone 9841234567, email sunita.l@gmail.com. My citizenship no. 123/4567. " +
      "I live at house no. 23 and drive Ba 2 Pa 1234. See facebook.com/sunita.lama.";
    const found = detectLeaks(text);
    expect(found.map((f) => f.type)).toEqual([
      "personal-name",
      "phone",
      "email",
      "national-id",
      "street-address",
      "vehicle-plate",
      "personal-url",
    ]);
    for (const f of found) expect(text.slice(f.start, f.end)).toBe(f.text);
  });

  it("returns nothing for a report with no identifying details", () => {
    const text =
      "The district office has been charging Rs 5,000 extra for every land registration since 2080. " +
      "Staff say the money goes to a senior official. Ward No. 4 residents have complained twice.";
    expect(detectLeaks(text)).toEqual([]);
  });

  it("handles an empty string", () => {
    expect(detectLeaks("")).toEqual([]);
  });
});
