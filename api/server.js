// Waitlist API: takes RSVPs, enqueues their confirmation emails, serves the attendee list
// and the frontend, and reports health the way the on-call session's runbook expects.
import express from "express";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const app = express();
app.use(express.json());

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// The admin channel: the sync controller touches this to reload the code a deploy brought.
const commitFile = "/run/commit";

app.get("/health", async (_req, res) => {
  const { rows: state } = await db.query(
    "SELECT beat_at, processed, last_message FROM consumer_state WHERE id = 1",
  );
  const { rows: backlog } = await db.query(
    "SELECT count(*)::int AS pending, extract(epoch FROM max(now() - created_at))::int AS oldest FROM queue WHERE claimed_at IS NULL",
  );
  const consumer = state[0] ?? {};
  const age = consumer.beat_at
    ? Math.round((Date.now() - new Date(consumer.beat_at).getTime()) / 1000)
    : null;
  res.json({
    api: "up",
    consumer: {
      status: age === null ? "unknown" : age < 15 ? "up" : "stalled",
      last_beat_seconds_ago: age,
      processed: consumer.processed,
      note: consumer.last_message,
    },
    queue: backlog[0],
  });
});

app.get("/stats", async (_req, res) => {
  const { rows } = await db.query(
    `SELECT e.id, e.name, e.capacity,
            count(r.id) FILTER (WHERE r.id IS NOT NULL)::int AS rsvps,
            count(q.id) FILTER (WHERE q.id IS NOT NULL)::int AS confirmations
       FROM events e
       LEFT JOIN rsvps r ON r.event_id = e.id
       LEFT JOIN queue q ON q.rsvp_id = r.id
      GROUP BY e.id, e.name, e.capacity ORDER BY e.id`,
  );
  res.json(rows);
});

app.post("/rsvps", async (req, res) => {
  const { event_id, name, email, guests } = req.body ?? {};
  const who = typeof name === "string" ? name.trim() : "";
  const mail = typeof email === "string" ? email.trim() : "";
  if (!Number.isInteger(event_id) || event_id < 1
      || !who || who.length > 80 || !mail.includes("@") || mail.length > 120
      || guests !== undefined && (!Number.isInteger(guests) || guests < 1 || guests > 12)) {
    return res.status(400).json({ error: "invalid RSVP" });
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const event = await client.query(
      "SELECT id, name FROM events WHERE id = $1", [event_id],
    );
    if (!event.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "no such event" });
    }
    const rsvp = await client.query(
      `INSERT INTO rsvps (event_id, name, email, guests) VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, guests, created_at`,
      [event_id, who, mail, guests ?? 1],
    );
    await client.query(
      "INSERT INTO queue (rsvp_id) VALUES ($1)", [rsvp.rows[0].id],
    );
    await client.query("COMMIT");
    res.status(201).json({ ...rsvp.rows[0], event: event.rows[0].name });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("rsvp failed:", err.message);
    res.status(500).json({ error: "could not save the RSVP" });
  } finally {
    client.release();
  }
});

app.get("/rsvps", async (req, res) => {
  const event = Number(req.query.event_id);
  const { rows } = await db.query(
    `SELECT r.id, r.name, r.guests, r.confirmed, r.created_at
       FROM rsvps r WHERE ($1::integer IS NULL OR r.event_id = $1)
      ORDER BY r.id DESC LIMIT 50`,
    [Number.isInteger(event) && event > 0 ? event : null],
  );
  res.json(rows);
});

app.get("/emails", async (_req, res) => {
  const { rows } = await db.query(
    `SELECT e.id, r.name, e.body, e.sent_at FROM sent_emails e
       JOIN rsvps r ON r.id = e.rsvp_id ORDER BY e.id DESC LIMIT 20`,
  );
  res.json(rows);
});

// Ops surface the on-call collects from (runbook: health, then logs, then stats).
app.get("/admin/logs", async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.query.token !== token) {
    return res.status(403).json({ error: "wrong admin token" });
  }
  const name = String(req.query.service ?? "api").replace(/[^a-z]/g, "");
  const file = `/run/log/${name}.log`;
  const tail = await fs.promises
    .readFile(file, "utf8")
    .catch(() => "");
  const lines = tail.split("\n").filter(Boolean).slice(-60);
  res.json({ service: name, lines });
});

app.get("/admin/reload", async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.query.token !== token) {
    return res.status(403).json({ error: "wrong admin token" });
  }
  const commit = fs.readFileSync(commitFile, "utf8").trim();
  res.json({ reloading: true, commit });
  // A clean exit: compose restarts the service, which boots the new code.
  process.exit(0);
});

// The frontend and its assets, from the tree this container runs on.
const web = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "web");
app.use(express.static(web, { index: "index.html" }));

const port = Number(process.env.PORT ?? 4001);
app.listen(port, () => console.log(`api up on ${port}`));
