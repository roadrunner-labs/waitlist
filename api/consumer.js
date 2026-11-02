// The confirmation consumer: drains the queue by sending every confirmation through the
// venue registry, and reports a heartbeat into consumer_state for /health.
import pg from "pg";
import { confirm } from "./registry.js";

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
let processed = 0;

async function beat(note) {
  await db.query(
    "UPDATE consumer_state SET beat_at = now(), processed = $1, last_message = $2 WHERE id = 1",
    [processed, (note ?? "").slice(0, 120)],
  );
}

async function claim() {
  const { rows } = await db.query(
    `UPDATE queue SET claimed_at = now(), attempts = attempts + 1
      WHERE id = (SELECT id FROM queue WHERE claimed_at IS NULL ORDER BY id
                  FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, rsvp_id`,
  );
  return rows[0];
}

async function loadRsvp(id) {
  const { rows } = await db.query(
    `SELECT r.id, r.name, r.email, r.guests, e.name AS event, e.id AS event_id
       FROM rsvps r JOIN events e ON e.id = r.event_id
      WHERE r.id = $1`,
    [id],
  );
  return rows[0];
}

// "Sending" is the registry's mark, then the receipt becomes the email row.
async function processItem(item) {
  const rsvp = await loadRsvp(item.rsvp_id);
  if (!rsvp) {
    await db.query("UPDATE queue SET last_error = 'missing rsvp' WHERE id = $1", [item.id]);
    return "skipped";
  }
  const answer = await confirm(rsvp)
    .then(({ confirmation }) => confirmation)
    .then(async (confirmation) => {
      const receipt = confirmation.receipt;
      await db.query(
        "INSERT INTO sent_emails (rsvp_id, body) VALUES ($1, $2)",
        [rsvp.id, `Hi ${rsvp.name} — you are on the list for ${rsvp.event}, receipt ${receipt}.`],
      );
      await db.query("UPDATE rsvps SET confirmed = true, confirmed_at = now() WHERE id = $1", [
        rsvp.id,
      ]);
      await db.query("DELETE FROM queue WHERE id = $1", [item.id]);
      return `confirmed #${rsvp.id}`;
    });
  processed += 1;
  return answer;
}

async function tick() {
  const item = await claim();
  if (!item) {
    await beat("queue drained");
    return;
  }
  // Send on its own: the next claim does not wait for the write-through.
  processItem(item).then((answered) => beat(answered));
  await beat("sending");
}

const pause = Number(process.env.ITEM_PAUSE_MS ?? 1500);

async function main() {
  await beat("started");
  while (!stopping) {
    try {
      await tick();
    } catch (err) {
      console.error("tick failed:", err.message);
      await beat(`tick failed: ${err.message.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 4000));
    }
    await new Promise((r) => setTimeout(r, pause));
  }
  await beat("stopped");
}

main();
