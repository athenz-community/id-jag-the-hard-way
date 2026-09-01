import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class Api {
    static final JSONArray docs = new JSONArray("""
        [
            {"name": "first default doc", "id": 1, "content": "hello world"},
            {"name": "second default doc", "id": 2, "content": "how are you?"}
        ]
    """);

    static final int PORT = Integer.parseInt(System.getenv().getOrDefault("PORT", "14443"));
    static final String RESOURCE_NAME = "api:docs";

    static Authorizer authorizer;
    
    static int docIdSequence = 2;

    public static void main(String[] args) throws Exception {
        authorizer = new Authorizer();

        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);

        server.createContext("/api/docs", exchange -> {
            try {
                String method = exchange.getRequestMethod();
                String path = exchange.getRequestURI().getPath();
                String timestamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
                
                System.out.println(String.format("[%s] [INFO] Request received: %s %s", timestamp, method, path));

                authorizer.authorizeRequest(exchange, RESOURCE_NAME);

                if ("GET".equalsIgnoreCase(method)) {
                    JSONArray activeDocs = new JSONArray();
                    for (int i = 0; i < docs.length(); i++) {
                        JSONObject doc = docs.getJSONObject(i);
                        if (!doc.optBoolean("isDeleted", false)) {
                            activeDocs.put(doc);
                        }
                    }
                    sendResponse(exchange, 200, new JSONObject().put("docs", activeDocs).toString());
                    
                } else if ("POST".equalsIgnoreCase(method)) {
                    InputStream is = exchange.getRequestBody();
                    JSONObject newDoc = new JSONObject(new String(is.readAllBytes(), StandardCharsets.UTF_8));

                    newDoc.put("id", ++docIdSequence);
                    
                    docs.put(newDoc);
                    sendResponse(exchange, 201, new JSONObject().put("success", true).put("doc", newDoc).toString());
                    
                } else if ("DELETE".equalsIgnoreCase(method)) {
                    try {
                        Integer targetId = parseDocumentId(exchange.getRequestURI().getRawPath());
                        if (targetId == null) {
                            sendResponse(exchange, 400, new JSONObject()
                                    .put("error", "Bad Request")
                                    .put("message", "Document ID is required in the path (e.g., /api/docs/{doc_id}).")
                                    .toString());
                            return;
                        }

                        boolean foundAndDeleted = false;
                        
                        for (int i = 0; i < docs.length(); i++) {
                            JSONObject doc = docs.getJSONObject(i);
                            if (doc.getInt("id") == targetId && !doc.optBoolean("isDeleted", false)) {
                                doc.put("isDeleted", true);
                                foundAndDeleted = true;
                                break;
                            }
                        }
                        
                        if (foundAndDeleted) {
                            sendResponse(exchange, 200, new JSONObject()
                                    .put("success", true)
                                    .put("message", "Document " + targetId + " deleted successfully.")
                                    .toString());
                        } else {
                            sendResponse(exchange, 404, new JSONObject()
                                    .put("error", "Not Found")
                                    .put("message", "Document with id " + targetId + " does not exist or is already deleted.")
                                    .toString());
                        }
                    } catch (NumberFormatException e) {
                        sendResponse(exchange, 400, new JSONObject()
                                .put("error", "Bad Request")
                                .put("message", "Invalid ID format. ID must be an integer.")
                                .toString());
                    }
                } else {
                    sendResponse(exchange, 405, "{\"error\": \"Method Not Allowed\"}");
                }

            } catch (IllegalArgumentException e) { // if 401
                System.err.printf("[%s] [WARN] Unauthorized request: %s%n", 
                        LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")), e.getMessage());
                        
                JSONObject err = new JSONObject()
                        .put("status", 401)
                        .put("error", "Unauthorized")
                        .put("message", e.getMessage());
                try {
                    sendResponse(exchange, 401, err.toString());
                } catch (Exception ex) {}

            } catch (SecurityException e) { // if 403
                System.err.printf("[%s] [WARN] Forbidden request (Athenz API Server with ZPE): %s%n",
                        LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")), e.getMessage());
                        
                JSONObject err = new JSONObject()
                        .put("status", 403)
                        .put("error", "Forbidden")
                        .put("message", "Access denied by Athenz API Server with ZPE.")
                        .put("details", e.getMessage());
                try {
                    sendResponse(exchange, 403, err.toString());
                } catch (Exception ex) {}

            } catch (Throwable e) { // if 500
                System.err.printf("[%s] [ERROR] Internal Server Error: %s%n", 
                        LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")), e.getMessage());
                e.printStackTrace();
                try {
                    sendResponse(exchange, 500, "{\"error\": \"Internal Server Error\"}");
                } catch (IOException ex) {}
            }
        });

        server.start();
        String jwkUri = System.getProperty("athenz.zpe.jwk_uri", "(not set)");
        System.out.println("\n=========================================================");
        System.out.println("🚀 API Server listening on http://0.0.0.0:" + PORT);
        System.out.println("🛡️  Athenz Required: " + authorizer.isRequired());
        if (authorizer.isRequired()) {
            System.out.println("🔑 Athenz ZTS JWK URI: " + jwkUri);
        }
        System.out.println("📄 Docs endpoint: http://0.0.0.0:" + PORT + "/api/docs");
        System.out.println("=========================================================\n");
    }

    private static Integer parseDocumentId(String rawPath) {
        String docsPath = "/api/docs";
        String docsPathWithSlash = docsPath + "/";

        if (rawPath.equals(docsPath) || rawPath.equals(docsPathWithSlash)) {
            return null;
        }

        if (!rawPath.startsWith(docsPathWithSlash)) {
            throw new NumberFormatException("Path must match /api/docs/{doc_id}");
        }

        String rawId = rawPath.substring(docsPathWithSlash.length());
        if (rawId.endsWith("/")) {
            rawId = rawId.substring(0, rawId.length() - 1);
        }

        if (rawId.isEmpty() || rawId.contains("/")) {
            throw new NumberFormatException("Document ID must be a single path segment");
        }

        String id = URLDecoder.decode(rawId, StandardCharsets.UTF_8);
        if (id.isEmpty() || !id.chars().allMatch(Character::isDigit)) {
            throw new NumberFormatException("Document ID must be an integer");
        }

        return Integer.parseInt(id);
    }

    private static void sendResponse(HttpExchange exchange, int code, String res) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        byte[] bytes = res.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }
}
