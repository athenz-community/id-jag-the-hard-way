FROM alpine:3.20

RUN apk add --no-cache bash curl ca-certificates tzdata

COPY zpu.sh /usr/local/bin/zpu.sh
RUN chmod +x /usr/local/bin/zpu.sh

ENTRYPOINT ["/usr/local/bin/zpu.sh"]
