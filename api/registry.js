import pg from "pg";

// The venue registry: the one place that decides whether the list takes another party.
// An answer is either { receipt } for a confirmed mark or { refused, reason } — the venue
// does not overbook.
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function confirm(rsvp) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows: marked } = await client.query(
      "UPDATE rsvps SET confirmed = true WHERE id = $1 AND NOT confirmed RETURNING id",
      [rsvp.id],
    );
    if (!marked[0]) {
      await client.query("COMMIT");
      return { receipt: "W-" + rsvp.id + "-already" };
    }
    const { rows: full } = await client.query(
      `SELECT e.capacity <= count(r.*) FILTER (WHERE r.confirmed) AS full
         FROM events e LEFT JOIN rsvps r ON r.event_id = e.id
        WHERE e.id = $1 GROUP BY e.capacity`,
      [rsvp.event_id],
    );
    if (full[0].full) {
      await client.query("ROLLBACK");
      return { refused: true, reason: "the event list is full" };
    }
    await client.query("COMMIT");
    return { receipt: "W-" + rsvp.id };
  } finally {
    client.release();
  }
}
