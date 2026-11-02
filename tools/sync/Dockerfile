# The deploy controller: pulls origin/main into this tree every few seconds, and when the
# tree moves, stamps the new commit and pokes the services to reload. Deploys are merges.
FROM alpine:3.20
RUN apk add --no-cache git curl
COPY entry.sh /entry.sh
RUN chmod +x /entry.sh
WORKDIR /srv/waitlist
ENTRYPOINT ["/entry.sh"]
