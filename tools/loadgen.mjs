// The launch's traffic: mostly small parties at a steady clip, so the list fills fast
// enough for its own confirmation queue to matter. Runs until interrupted.
const api = process.env.API_URL ?? "http://api:4001";
const event = Number(process.env.EVENT_ID ?? 1);
const every = Number(process.env.NEVER_EVERY_MS ?? 1200);

const names = ["Ada", "Grace", "Linus", "Katherine", "Marin", "Sol", "June", "Theo", "Adaora", "Ken"];
const part = Math.random();
let i = 0;

async function send() {
  i += 1;
  const name = `${names[i % names.length]} ${i}`;
  const res = await fetch(`${api}/rsvps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_id: event,
      name,
      email: `${name.toLowerCase().replaceAll(" ", ".")}${i}@guest.dev`,
      guests: 1 + (i % 3),
    }),
  });
  if (!res.ok) console.error(`rsvp failed: ${res.status} ${await res.text()}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
while (true) {
  await send().catch(() => {});
  await sleep(every);
}
