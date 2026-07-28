// Minimal self-check for the FlareSolverr concurrency gate. Run: node test.js
const assert = require("assert");
const { acquireSlot, releaseSlot, DETAIL_CONCURRENCY } = require("./index");

async function main() {
  let running = 0;
  let peak = 0;
  let done = 0;

  const task = async () => {
    await acquireSlot();
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 10));
    running--;
    done++;
    releaseSlot();
  };

  await Promise.all(Array.from({ length: 10 }, task));

  assert.strictEqual(done, 10, "every task must complete (no deadlock)");
  assert.strictEqual(running, 0, "no slot leaked");
  assert.ok(peak <= DETAIL_CONCURRENCY, `peak in-flight ${peak} exceeded ${DETAIL_CONCURRENCY}`);
  console.log(`ok — 10 tasks, peak in-flight ${peak} (limit ${DETAIL_CONCURRENCY})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
