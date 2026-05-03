import {
  NumberDictionary,
  adjectives,
  animals,
  uniqueNamesGenerator,
} from "unique-names-generator";

const RESERVED_SLUGS = new Set(["trash", "new", "settings", "api", "health", "ws"]);

const numbers = NumberDictionary.generate({ length: 2 });

export function generateSlug(): string {
  for (;;) {
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
