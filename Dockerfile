FROM debian:bookworm-slim

ARG GROKBOT_VERSION=1.0.3
ARG GROKBOT_COMMIT=be8eaf76ba888db05a6a8950922f5fc8bb4d14e9

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl dbus-x11 node-ws python3 xvfb xauth util-linux \
    && rm -rf /var/lib/apt/lists/*
RUN grok_deb_arch="$(dpkg --print-architecture)" \
    && case "$grok_deb_arch" in amd64) grok_arch=x64 ;; arm64) grok_arch=arm64 ;; *) exit 1 ;; esac \
    && curl -fL --retry 2 -o /tmp/grok-bot.deb \
       "https://downloads.cursor.com/grokbot/stable/${GROKBOT_COMMIT}/linux/${grok_arch}/grok-bot_${GROKBOT_VERSION}_${grok_deb_arch}.deb" \
    && apt-get update && apt-get install -y --no-install-recommends /tmp/grok-bot.deb \
    && rm -rf /var/lib/apt/lists/* /tmp/grok-bot.deb
RUN useradd -m -u 1000 bot && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix
COPY web /opt/grok-web
RUN python3 /opt/grok-web/prepare.py '/opt/Grok Bot/resources/app.asar' '/opt/Grok Bot/resources/web.asar' \
    && mv '/opt/Grok Bot/resources/app.asar' '/opt/Grok Bot/resources/vendor.asar' \
    && mv '/opt/Grok Bot/resources/web.asar' '/opt/Grok Bot/resources/app.asar'
COPY web-start.sh /usr/local/bin/start-grok-web
RUN chmod +x /usr/local/bin/start-grok-web
ENV GROK_DATA=/data
WORKDIR /data
EXPOSE 8080
CMD ["node", "/opt/grok-web/gateway.cjs"]
