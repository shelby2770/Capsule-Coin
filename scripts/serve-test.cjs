// Local-only test server: runs `next dev` against an ISOLATED Firestore ledger
// doc (capsule_test) with sheet sync disabled, so UI testing never touches the
// production ledger or the shared Google Sheet. Not used in deployment.
const path = require("path");
const { spawn } = require("child_process");

const env = {
  ...process.env,
  LEDGER_DOC_ID: "capsule_test",
  GOOGLE_SHEETS_ID: "none", // invalid but non-empty → sheet writes fail harmlessly
};

const p = spawn("npx", ["next", "dev", "-p", "2771"], {
  stdio: "inherit",
  cwd: path.join(__dirname, ".."),
  env,
  shell: true, // Windows: resolve npx.cmd through the shell
});
p.on("exit", (c) => process.exit(c ?? 0));
