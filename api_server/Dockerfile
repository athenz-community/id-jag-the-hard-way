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

ENV PORT=8080
ENV AT_REQUIRED=false
ENV JAVA_TOOL_OPTIONS="-Dathenz.zpe.policy_dir=/app/policies \
-Dathenz.zpe.jwk_uri=https://athenz-zts-server.athenz:4443/zts/v1/oauth2/keys?rfc=true"

EXPOSE 8080

CMD ["java", "-cp", "classes:dependency/*", "Api"]
