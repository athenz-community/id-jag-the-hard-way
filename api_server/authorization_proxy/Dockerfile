FROM maven:3.9.9-eclipse-temurin-17 AS build

WORKDIR /src

COPY pom.xml .

RUN mvn -B -DskipTests dependency:go-offline

COPY src ./src

RUN mvn -B -DskipTests clean package && \
    JAR_FILE="$(find target -maxdepth 1 -type f -name '*.jar' ! -name '*.original' | head -n 1)" && \
    cp "${JAR_FILE}" /tmp/app.jar

FROM eclipse-temurin:17-jre

WORKDIR /app

COPY --from=build /tmp/app.jar /app/app.jar

ENV SERVER_PORT=4180
ENV MCP_TARGET_URL=http://mcp-server.api.svc.cluster.local

EXPOSE 4180

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
