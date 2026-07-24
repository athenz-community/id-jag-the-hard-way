FROM alpine:3.22

COPY target/local-workload-instance-provider.jar /plugin.jar

CMD ["/bin/sh", "-c", "cp /plugin.jar /export/local-workload-instance-provider.jar && chmod 644 /export/local-workload-instance-provider.jar"]
