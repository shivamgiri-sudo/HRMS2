import { randomInt } from "crypto";
import bcrypt from "bcryptjs";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const NUMBER = "23456789";
const SPECIAL = "!@#$%^&*?";
const ALL = `${UPPER}${LOWER}${NUMBER}${SPECIAL}`;

function pick(chars: string): string {
  return chars[randomInt(0, chars.length)];
}

function shuffle(chars: string[]): string[] {
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
  }
  return chars;
}

export function generateTemporaryPassword(length = 14): string {
  const safeLength = Math.max(12, length);
  const chars = [
    pick(UPPER),
    pick(LOWER),
    pick(NUMBER),
    pick(SPECIAL),
  ];
  while (chars.length < safeLength) {
    chars.push(pick(ALL));
  }
  return shuffle(chars).join("");
}

export async function createTemporaryPasswordCredential(): Promise<{
  temporaryPassword: string;
  passwordHash: string;
}> {
  const temporaryPassword = generateTemporaryPassword();
  return {
    temporaryPassword,
    passwordHash: await bcrypt.hash(temporaryPassword, 10),
  };
}
