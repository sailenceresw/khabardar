/**
 * Small on-device name lists for the personal-name detector.
 *
 * These are deliberately short: common given names and surnames from Nepal and
 * the UK. They exist to anchor the capitalisation rule, so a run of capitalised
 * words is only treated as a name when at least one word is a known name. A
 * name outside the lists is missed; LEAK_CHECKER.md says so.
 *
 * Everything is lower case. Matching lower-cases the candidate.
 */

export const GIVEN_NAMES: ReadonlySet<string> = new Set([
  // Nepal
  "aarati", "aarti", "abhishek", "anil", "anita", "anjali", "arjun", "asha", "ashok", "babita",
  "bibek", "bijay", "bikash", "binod", "bishnu", "deepak", "dipak", "dipendra", "durga", "ganesh",
  "gita", "gopal", "hari", "indira", "janak", "kabita", "kamal", "kamala", "kiran", "krishna",
  "kumar", "laxmi", "mahesh", "manish", "manoj", "mina", "mohan", "nabin", "narayan", "nirmala",
  "prakash", "pradeep", "prem", "puja", "pooja", "rabin", "rajendra", "rajesh", "ram", "ramesh",
  "rita", "sabina", "sagar", "sanjay", "santosh", "saraswati", "shanti", "shyam", "sita", "sujan",
  "sunil", "sunita", "suresh", "sushila", "umesh",
  // UK
  "alice", "amelia", "andrew", "charlotte", "chloe", "daniel", "david", "edward", "elizabeth", "emily",
  "emma", "george", "harry", "helen", "jack", "james", "jane", "jessica", "john", "joseph",
  "katherine", "laura", "lucy", "margaret", "mary", "matthew", "michael", "oliver", "olivia", "paul",
  "peter", "rachel", "richard", "robert", "sarah", "sophie", "stephen", "susan", "thomas", "william",
]);

export const SURNAMES: ReadonlySet<string> = new Set([
  // Nepal
  "acharya", "adhikari", "basnet", "bhandari", "bhattarai", "bishwokarma", "bista", "chaudhary", "dahal", "ghimire",
  "gurung", "joshi", "kc", "karki", "khadka", "koirala", "lama", "limbu", "magar", "maharjan",
  "nepali", "pandey", "pariyar", "paudel", "poudel", "rai", "rana", "regmi", "sharma", "sherpa",
  "shrestha", "tamang", "thapa", "tharu", "yadav",
  // UK
  "baker", "clarke", "davies", "edwards", "evans", "harris", "harrison", "hughes", "jackson", "johnson",
  "jones", "lewis", "martin", "mitchell", "morgan", "patel", "roberts", "robinson", "smith", "taylor",
  "thompson", "turner", "walker", "williams", "wilson", "wright",
]);

/**
 * Given names that are also everyday words or place names. These still count
 * inside a multi-word name ("Ram Prasad Sharma") but are never flagged alone,
 * because "Prem" in a sentence is as likely to mean love as a person, and
 * "Krishna" is often a temple or a festival.
 */
export const AMBIGUOUS_ALONE: ReadonlySet<string> = new Set([
  "asha", "durga", "ganesh", "jack", "kamal", "krishna", "kumar", "laxmi", "mina", "prem",
  "ram", "saraswati", "shanti",
]);

/** Honorifics that mark the next capitalised word as a name even if it is not in the lists. */
export const TITLES: ReadonlySet<string> = new Set([
  "mr", "mrs", "ms", "miss", "dr", "shri", "shree", "sri", "smt", "sir",
]);
