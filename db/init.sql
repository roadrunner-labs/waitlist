-- Waitlist: events, RSVPs, and the confirmation queue the job consumer drains.
CREATE TABLE events (
    id          serial PRIMARY KEY,
    name        text NOT NULL,
    capacity    integer NOT NULL DEFAULT 1000,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rsvps (
    id           serial PRIMARY KEY,
    event_id     integer NOT NULL REFERENCES events (id),
    name         text NOT NULL,
    email        text NOT NULL,
    guests       integer NOT NULL DEFAULT 1 CHECK (guests > 0 AND guests <= 12),
    confirmed    boolean NOT NULL DEFAULT false,
    confirmed_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- The confirmation queue: one row per RSVP the consumer must acknowledge by email.
CREATE TABLE queue (
    id            bigserial PRIMARY KEY,
    rsvp_id       integer NOT NULL REFERENCES rsvps (id),
    claimed_at    timestamptz,
    attempts      integer NOT NULL DEFAULT 0,
    last_error    text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sent_emails (
    id          bigserial PRIMARY KEY,
    rsvp_id     integer NOT NULL REFERENCES rsvps (id),
    body        text NOT NULL,
    sent_at     timestamptz NOT NULL DEFAULT now()
);

-- The consumer heartbeats here; /health reads it.
CREATE TABLE consumer_state (
    id            integer PRIMARY KEY DEFAULT 1,
    beat_at       timestamptz,
    processed     integer NOT NULL DEFAULT 0,
    last_message  text
);
INSERT INTO consumer_state (id) VALUES (1);

INSERT INTO events (name, capacity) VALUES
    ('AgentHive Launch Party', 500),
    ('YC Demo Night', 400);

-- The launch is nearly full: the queue has a little room to hurt the demo's incident rightly.
INSERT INTO rsvps (event_id, name, email, guests, confirmed, confirmed_at, created_at)
SELECT 1,
       'Guest ' || g,
       'guest' || g || '@example.dev',
       1 + g % 3,
       true,
       now() - (g || ' minutes'),
       now() - (g || ' minutes')
  FROM generate_series(1, 480) AS g;

CREATE INDEX queue_open_idx ON queue (id) WHERE claimed_at IS NULL;
