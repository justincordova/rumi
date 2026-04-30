import {
  NumberDictionary,
  adjectives,
  animals,
  uniqueNamesGenerator,
} from "unique-names-generator";

const numbers = NumberDictionary.generate({ length: 2 });

export function generateSlug(): string {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, animals, numbers],
    separator: "-",
    style: "lowerCase",
  });
}

export function fallbackSlug(): string {
  // Used after 5 collision retries — appends a 4-char UUID fragment.
  return `${generateSlug()}-${crypto.randomUUID().slice(0, 4)}`;
}
