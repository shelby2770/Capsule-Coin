import "server-only";

/**
 * The FULL Capsule Coin transaction history — every real trade, no opening-balance
 * plugs. Applied once to a fresh ledger via POST /api/seed (guarded by SEED_TOKEN);
 * `?rebuild=1` wipes and re-imports. Convention: seller RECEIVES CC, buyer PAYS.
 * Each trade carries its real timestamp; the importer replays them chronologically
 * so balances, the ledger, and the value chart are all exact.
 *
 * Date provenance:
 *  - Pre-app trades: from the manual "Capsule Currency" sheet's version history
 *    (a few, marked `est`, weren't captured in a version and are best-effort).
 *  - App-era "approved request" trades: exact times from the app's history export.
 *
 * Every balance nets to 0 (a pure transfer economy — no coins minted).
 */
export const SEED_TRANSACTIONS: Array<{
  item: string;
  amount: number;
  sellerEmail: string; // receives CC
  buyerEmail: string; // pays CC
  date: string; // ISO timestamp
}> = [
  // ── Pre-app legacy (dates from the sheet's version history; est = estimate) ──
  { item: "Roast", amount: 20, sellerEmail: "ashap.bappy@orbitax.com", buyerEmail: "riaz.khan@orbitax.com", date: "2026-08-03T18:58:00+06:00" },
  { item: "Burger", amount: 15, sellerEmail: "riaz.khan@orbitax.com", buyerEmail: "ishtiaq.samiul@orbitax.com", date: "2026-08-03T19:11:00+06:00" },
  { item: "Shrimp", amount: 300, sellerEmail: "ishtiaq.samiul@orbitax.com", buyerEmail: "amdadul.haque@orbitax.com", date: "2026-08-05T16:00:00+06:00" },
  { item: "Photography", amount: 49, sellerEmail: "adnan.istiaque@orbitax.com", buyerEmail: "enamul.hasan@orbitax.com", date: "2026-08-09T11:12:00+06:00" },
  { item: "Photography", amount: 99, sellerEmail: "adnan.istiaque@orbitax.com", buyerEmail: "riaz.khan@orbitax.com", date: "2026-08-09T13:25:00+06:00" },
  { item: "KFC Chicken", amount: 50, sellerEmail: "riaz.khan@orbitax.com", buyerEmail: "amdadul.haque@orbitax.com", date: "2026-08-12T18:21:00+06:00" },
  { item: "Pineapple", amount: 50, sellerEmail: "fayjul.islam@orbitax.com", buyerEmail: "amdadul.haque@orbitax.com", date: "2026-08-12T18:22:00+06:00" },
  { item: "Pizza", amount: 100, sellerEmail: "riaz.khan@orbitax.com", buyerEmail: "ashap.bappy@orbitax.com", date: "2026-08-14T12:00:00+06:00" }, // est
  { item: "Lending money in Cox Bazar", amount: 30, sellerEmail: "enamul.hasan@orbitax.com", buyerEmail: "riaz.khan@orbitax.com", date: "2026-08-14T14:00:00+06:00" }, // Riaz → Enam; time est
  { item: "Burger", amount: 40, sellerEmail: "nayeem.hossain@orbitax.com", buyerEmail: "fayjul.islam@orbitax.com", date: "2026-08-18T14:00:00+06:00" },
  { item: "Burger", amount: 50, sellerEmail: "prottya.roy@orbitax.com", buyerEmail: "ashap.bappy@orbitax.com", date: "2026-08-18T17:17:00+06:00" },
  { item: "Burger", amount: 40, sellerEmail: "nayeem.hossain@orbitax.com", buyerEmail: "fayjul.islam@orbitax.com", date: "2026-08-20T12:00:00+06:00" }, // est
  { item: "Pizza", amount: 68, sellerEmail: "riaz.khan@orbitax.com", buyerEmail: "adnan.istiaque@orbitax.com", date: "2026-08-23T13:00:00+06:00" }, // Adnan bought from Riaz (time est)
  { item: "KFC Chicken", amount: 25, sellerEmail: "riaz.khan@orbitax.com", buyerEmail: "fayjul.islam@orbitax.com", date: "2026-08-24T15:25:00+06:00" },
  { item: "Burger + Pineapple", amount: 70, sellerEmail: "adnan.istiaque@orbitax.com", buyerEmail: "ashap.bappy@orbitax.com", date: "2026-08-24T17:42:00+06:00" },
  { item: "Burger", amount: 20, sellerEmail: "sabbir.hasan@orbitax.com", buyerEmail: "ashap.bappy@orbitax.com", date: "2026-08-25T18:42:00+06:00" },
  { item: "Gift 🎁", amount: 1, sellerEmail: "nayeem.hossain@orbitax.com", buyerEmail: "mainul.ahsan@orbitax.com", date: "2026-08-25T18:43:00+06:00" },
  { item: "Pizza", amount: 70, sellerEmail: "riaz.khan@orbitax.com", buyerEmail: "adnan.istiaque@orbitax.com", date: "2026-08-26T12:00:00+06:00" }, // est
  { item: "Pizza", amount: 70, sellerEmail: "prottya.roy@orbitax.com", buyerEmail: "ishtiaq.samiul@orbitax.com", date: "2026-08-26T14:00:00+06:00" }, // est (August pizza)
  { item: "Pizza (1 piece)", amount: 40, sellerEmail: "ishtiaq.samiul@orbitax.com", buyerEmail: "amdadul.haque@orbitax.com", date: "2026-08-27T12:00:00+06:00" }, // est
  { item: "Pineapple", amount: 30, sellerEmail: "ishtiaq.samiul@orbitax.com", buyerEmail: "nayeem.hossain@orbitax.com", date: "2026-08-28T12:00:00+06:00" }, // est
  // ── Not in the app export — dates from group tables/screenshots ──
  { item: "Pizza (1 piece)", amount: 40, sellerEmail: "adnan.istiaque@orbitax.com", buyerEmail: "mainul.ahsan@orbitax.com", date: "2026-08-30T13:00:00+06:00" },
  { item: "Pizza", amount: 70, sellerEmail: "nayeem.hossain@orbitax.com", buyerEmail: "ashap.bappy@orbitax.com", date: "2026-08-30T15:00:00+06:00" },
  { item: "Burger", amount: 15, sellerEmail: "masum.billah@orbitax.com", buyerEmail: "enamul.hasan@orbitax.com", date: "2026-08-31T15:00:00+06:00" },
  { item: "Chicken fry", amount: 15, sellerEmail: "ashap.bappy@orbitax.com", buyerEmail: "enamul.hasan@orbitax.com", date: "2026-09-02T13:00:00+06:00" },
  { item: "Chicken Fry", amount: 10, sellerEmail: "amdadul.haque@orbitax.com", buyerEmail: "enamul.hasan@orbitax.com", date: "2026-09-02T14:00:00+06:00" }, // Enam → Amdad; time est
  { item: "Chocolate cake", amount: 5, sellerEmail: "nayeem.hossain@orbitax.com", buyerEmail: "ashap.bappy@orbitax.com", date: "2026-09-03T13:00:00+06:00" },
  // ── App-era "approved request" trades — exact times from the history export ──
  { item: "Burger", amount: 5, sellerEmail: "shafi.kader@orbitax.com", buyerEmail: "mainul.ahsan@orbitax.com", date: "2026-08-31T16:25:00+06:00" },
  { item: "Shashlik", amount: 7, sellerEmail: "riaz.khan@orbitax.com", buyerEmail: "mainul.ahsan@orbitax.com", date: "2026-09-01T13:32:00+06:00" },
  { item: "Shashlik", amount: 6, sellerEmail: "sabbir.hasan@orbitax.com", buyerEmail: "mainul.ahsan@orbitax.com", date: "2026-09-01T13:37:00+06:00" },
  { item: "Shashlik", amount: 5, sellerEmail: "shafi.kader@orbitax.com", buyerEmail: "mainul.ahsan@orbitax.com", date: "2026-09-01T17:32:00+06:00" },
  { item: "Fried Chicken", amount: 20, sellerEmail: "shafi.kader@orbitax.com", buyerEmail: "ishtiaq.samiul@orbitax.com", date: "2026-09-02T15:34:00+06:00" },
  { item: "Jambura", amount: 25, sellerEmail: "enamul.hasan@orbitax.com", buyerEmail: "riaz.khan@orbitax.com", date: "2026-09-02T18:42:00+06:00" },
  { item: "Ice cream", amount: 5, sellerEmail: "ashap.bappy@orbitax.com", buyerEmail: "riaz.khan@orbitax.com", date: "2026-09-03T17:38:00+06:00" },
  { item: "Ice cream", amount: 10, sellerEmail: "nayeem.hossain@orbitax.com", buyerEmail: "riaz.khan@orbitax.com", date: "2026-09-03T17:38:00+06:00" },
  { item: "Chicken fry", amount: 5, sellerEmail: "adnan.istiaque@orbitax.com", buyerEmail: "mainul.ahsan@orbitax.com", date: "2026-09-03T17:38:00+06:00" },
  // ── Sep 6 — exact times from the history export ──
  { item: "Apple", amount: 40, sellerEmail: "ishtiaq.samiul@orbitax.com", buyerEmail: "mainul.ahsan@orbitax.com", date: "2026-09-06T17:23:00+06:00" },
  { item: "Pizza", amount: 70, sellerEmail: "prottya.roy@orbitax.com", buyerEmail: "ishtiaq.samiul@orbitax.com", date: "2026-09-06T17:23:00+06:00" },
  { item: "Apple", amount: 40, sellerEmail: "adnan.istiaque@orbitax.com", buyerEmail: "fayjul.islam@orbitax.com", date: "2026-09-06T17:24:00+06:00" },
  { item: "Pizza", amount: 50, sellerEmail: "enamul.hasan@orbitax.com", buyerEmail: "adnan.istiaque@orbitax.com", date: "2026-09-06T17:24:00+06:00" },
  { item: "Pizza", amount: 40, sellerEmail: "shafi.kader@orbitax.com", buyerEmail: "mainul.ahsan@orbitax.com", date: "2026-09-06T17:35:00+06:00" },
];
