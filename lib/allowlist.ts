import "server-only";

/**
 * The Capsule group — the ONLY emails permitted to register, each with their
 * current job title (role). Enforced server-side (see lib/auth/verify.ts + every
 * data route). Never trust the client for this.
 */
export type AllowlistEntry = { email: string; name: string; role: string };

export const ALLOWLIST: AllowlistEntry[] = [
  { email: "fayjul.islam@orbitax.com", name: "Fayjul Islam", role: "Software Engineer" },
  { email: "adnan.istiaque@orbitax.com", name: "Adnan Istiaque", role: "Associate Software Engineer" },
  { email: "ashap.bappy@orbitax.com", name: "Ashap Bappy", role: "Software Engineer" },
  { email: "asish.pal@orbitax.com", name: "Asish Pal", role: "Software Architect" },
  { email: "enamul.hasan@orbitax.com", name: "Enamul Hasan", role: "Associate Software Engineer" },
  { email: "ishtiaq.samiul@orbitax.com", name: "Ishtiaq Samiul", role: "Associate Software Engineer" },
  { email: "mujahedul.azad@orbitax.com", name: "Md Mujahedul Azad (Turin)", role: "Software Engineer" },
  { email: "amdadul.haque@orbitax.com", name: "Md. Amdadul Haque", role: "Associate Software Engineer" },
  { email: "jakir.hossen@orbitax.com", name: "Md. Jakir Hossen Shagor", role: "Software Engineer" },
  { email: "mainul.ahsan@orbitax.com", name: 'Md. Mainul Ahsan "Swaad"', role: "Associate Software Engineer" },
  { email: "masum.billah@orbitax.com", name: "Md. Masum Billah", role: "Software Engineer" },
  { email: "nayeem.hossain@orbitax.com", name: "Nayeem Hossain", role: "Software Engineer" },
  { email: "prottya.roy@orbitax.com", name: "Prottya Roy", role: "Software Engineer" },
  { email: "riaz.khan@orbitax.com", name: "Riaz Khan", role: "Associate Software Engineer" },
  { email: "sabbir.hasan@orbitax.com", name: "Sabbir Hasan", role: "Associate Software Engineer" },
  { email: "shafi.kader@orbitax.com", name: "Shafi Al Kader (Sopan)", role: "Principal Software Engineer" },
];

const byEmail = new Map(ALLOWLIST.map((e) => [e.email.toLowerCase(), e]));

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAllowed(email: string): boolean {
  return byEmail.has(normalizeEmail(email));
}

export function allowlistEntry(email: string): AllowlistEntry | undefined {
  return byEmail.get(normalizeEmail(email));
}

export function roleFor(email: string): string {
  return byEmail.get(normalizeEmail(email))?.role ?? "Member";
}
