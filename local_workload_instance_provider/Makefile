.PHONY: build test clean

MAVEN_FLAGS := \
	-Dmaven.resolver.transport=wagon \
	-Dmaven.wagon.http.ssl.insecure=true \
	-Dmaven.wagon.http.ssl.allowall=true

build:
	@mvn clean verify $(MAVEN_FLAGS)

test:
	@mvn test $(MAVEN_FLAGS)

clean:
	@mvn clean $(MAVEN_FLAGS)
