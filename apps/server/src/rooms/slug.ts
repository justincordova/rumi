import {
  NumberDictionary,
  adjectives,
  animals,
  uniqueNamesGenerator,
} from "unique-names-generator";

const RESERVED_SLUGS = new Set(["trash", "new", "settings", "api", "health", "ws"]);

export function generateSlug(): string {
  for (;;) {
    // Generate the number dictionary INSIDE the loop. NumberDictionary.generate
    // returns a single-element array containing one random number, not a list
    // of every value in the range. Caching it at module load froze the suffix
    // to one value for the whole process, so every slug shared the same
    // trailing number (e.g. `*-69`) and the two-digit suffix added zero
    // entropy — collapsing the keyspace and forcing the room-creation retry
    // loop to fall back far more often. Re-rolling per slug restores the
    // intended ~90x multiplier.
    const numbers = NumberDictionary.generate({ min: 10, max: 99 });
    const slug = uniqueNamesGenerator({
      dictionaries: [adjectives, animals, numbers],
      separator: "-",
      style: "lowerCase",
    });
    if (!RESERVED_SLUGS.has(slug)) return slug;
  }
}

export function fallbackSlug(): string {
  return `${generateSlug()}-${crypto.randomUUID().slice(0, 4)}`;
}
