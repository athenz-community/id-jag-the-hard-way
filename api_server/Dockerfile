FROM maven:3.9.9-eclipse-temurin-17 AS build

WORKDIR /src

COPY pom.xml .

RUN mvn -B -DskipTests dependency:go-offline

COPY src ./src

RUN mvn -B -DskipTests clean compile dependency:copy-dependencies

FROM eclipse-temurin:17-jre

WORKDIR /app

COPY --from=build /src/target/classes ./classes
COPY --from=build /src/target/dependency ./dependency

# Create empty-but-valid Athenz conf stubs so ZPE doesn't log WARN/ERROR on missing files
RUN mkdir -p /home/athenz/conf/athenz /var/lib/sia && \
    echo '{"zmsUrl":"","ztsUrl":"","ztsPublicKeys":[],"zmsPublicKeys":[]}' > /home/athenz/conf/athenz/athenz.conf && \
    echo '{"zts":{"keys":[]},"zms":{"keys":[]}}' > /var/lib/sia/athenz.conf

ENV PORT=8080
ENV AT_REQUIRED=false

EXPOSE 8080

CMD ["java", \
  "-Dathenz.zpe.policy_dir=/app/policies", \
  "-Dathenz.zpe.jwk_uri=https://athenz-zts-server.athenz:4443/zts/v1/oauth2/keys?rfc=true", \
  "-cp", "classes:dependency/*", \
  "Api"]
