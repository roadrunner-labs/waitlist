// Proves: a visitor who RSVPs is confirmed by the queue and gets a receipt email.
// POSTs one RSVP, then polls until the RSVP is confirmed, its receipt email is written and
// its queue item is gone, or fails saying which of those never happened.
// Uses YC Demo Night by default so a run does not spend the Launch Party's last spots.
//   node tools/e2e/rsvp-gets-confirmation-email.mjs   (BASE_URL, EVENT_ID, TIMEOUT_MS)
const base = process.env.BASE_URL ?? "http://host.docker.internal:4001";
const eventId = Number(process.env.EVENT_ID ?? 2);
const timeoutMs = Number(process.env.TIMEOUT_MS ?? 30000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path) {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}
function fail(reason, detail) {
  console.error(`FAIL: ${reason}`);
  if (detail) console.error(JSON.stringify(detail, null, 2));
  process.exit(1);
}

const stamp = Date.now();
const res = await fetch(`${base}/rsvps`, {
  method: "POST",
  signal: AbortSignal.timeout(5000),
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ event_id: eventId, name: `E2E ${stamp}`, email: `e2e+${stamp}@qa.test`, guests: 1 }),
});
const rsvp = await res.json().catch(() => null);
if (res.status !== 201 || !rsvp?.id) fail(`POST /rsvps answered ${res.status}`, rsvp);
console.log(`rsvp #${rsvp.id} saved for ${rsvp.event}`);

const deadline = Date.now() + timeoutMs;
let seen = {};
while (Date.now() < deadline) {
  const list = await get(`/rsvps?event_id=${eventId}`);
  const emails = await get("/emails");
  const health = await get("/health");
  const mine = list.find((r) => r.id === rsvp.id);
  const email = emails.find((e) => e.name === rsvp.name);
  seen = { confirmed: mine?.confirmed ?? null, email: email?.body ?? null, health };
  if (mine?.confirmed && email && health.queue.pending === 0) {
    if (!/receipt W-\d+/.test(email.body)) fail("receipt email has no receipt number", seen);
    console.log(`PASS: confirmed and emailed in ${Math.round((Date.now() + timeoutMs - deadline) / 1000)}s: ${email.body}`);
    process.exit(0);
  }
  await sleep(1000);
}

const why = [];
if (!seen.confirmed) why.push("RSVP never shown as confirmed");
if (!seen.email) why.push("no receipt email was written");
if (seen.health?.consumer?.status !== "up") why.push(`consumer is ${seen.health?.consumer?.status}`);
if (seen.health?.queue?.pending) why.push(`${seen.health.queue.pending} queue item(s) still pending`);
fail(`rsvp #${rsvp.id} not confirmed within ${timeoutMs / 1000}s: ${why.join("; ") || "unknown"}`, seen);
