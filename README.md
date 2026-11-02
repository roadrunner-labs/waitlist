# Waitlist

RSVP for launch events: you pick an event, a party size, and an email. The api saves the
RSVP and queues its confirmation; a consumer drains the queue by confirming each party
through the [venue registry](api/registry.js) and writing the receipt. Capacity is real:
the registry refuses a confirmation when an event's list is full.

## Run it

```sh
docker compose up -d --build            # web on :4001 (also /status.html), db on :5433
docker compose --profile load up -d     # the launch's traffic
```

Endpoints: `POST /rsvps`, `GET /rsvps?event_id=`, `GET /stats`, `GET /health`,
`GET /emails`, and the ops-only `GET /admin/logs?service=…&token=$ADMIN_TOKEN`.
Deploys are merges to `main`: [tools/sync](tools/sync) pulls the tree every few seconds
and reloads the services when it moves.
