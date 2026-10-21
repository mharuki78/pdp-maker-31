const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const run = (args) => {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run([
  require.resolve("typescript/bin/tsc"), "--module", "commonjs", "--moduleResolution", "node",
  "--target", "ES2022", "--esModuleInterop", "--skipLibCheck", "--outDir", "output/auth-tests",
  "tests/higgsfield-auth.test.ts",
]);
run(["--test", "output/auth-tests/tests/higgsfield-auth.test.js"]);
