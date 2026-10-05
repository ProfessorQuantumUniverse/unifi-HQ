# Collector: Vector mit eingebautem GoFlow2.
# GoFlow2 läuft als Kindprozess von Vector (exec-Source) und schreibt seine
# JSON-Zeilen direkt in die Pipeline: kein Docker-Socket, keine Log-Dateien,
# keine zusätzlichen Schreibzugriffe auf die SSD.
ARG GOFLOW2_VERSION=v2.2.7
ARG VECTOR_VERSION=0.58.0

FROM netsampler/goflow2:${GOFLOW2_VERSION} AS goflow2

FROM timberio/vector:${VECTOR_VERSION}-alpine
COPY --from=goflow2 /goflow2 /usr/local/bin/goflow2
# Unprivilegierter Benutzer; die Ports 2055/5514/8090 liegen über 1024
USER 65534:65534
ENTRYPOINT ["/usr/local/bin/vector"]
CMD ["--config", "/etc/vector/vector.yaml"]
