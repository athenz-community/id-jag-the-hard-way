FROM alpine:latest

COPY target/plugin-latest.jar /plugin.jar

CMD ["/bin/sh", "-c", "cp /plugin.jar /export/keycloak-token-provider.jar && chmod 644 /export/keycloak-token-provider.jar"]
