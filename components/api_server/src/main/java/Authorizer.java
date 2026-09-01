import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import com.sun.net.httpserver.HttpExchange;
import com.yahoo.athenz.zpe.AuthZpeClient;

import java.security.cert.X509Certificate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class Authorizer {

  private final boolean isRequired;
  private static final String DEFAULT_JWK_URI = "https://localhost:8443/zts/v1/oauth2/keys?rfc=true";

  private void disableSslVerification() {
    try {
      TrustManager[] trustAllCerts = new TrustManager[] {
          new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() {
              return null;
            }

            public void checkClientTrusted(X509Certificate[] certs, String authType) {
            }

            public void checkServerTrusted(X509Certificate[] certs, String authType) {
            }
          }
      };
      SSLContext sc = SSLContext.getInstance("SSL");
      sc.init(null, trustAllCerts, new java.security.SecureRandom());
      HttpsURLConnection.setDefaultSSLSocketFactory(sc.getSocketFactory());
      HttpsURLConnection.setDefaultHostnameVerifier((hostname, session) -> true);
    } catch (Exception e) {
      System.err.println("🔥 [ERROR] Failed to disable SSL Verification: " + e.getMessage());
    }
  }

  public Authorizer() {
    this.isRequired = Boolean.parseBoolean(System.getenv().getOrDefault("AT_REQUIRED", "true"));

    if (this.isRequired) {
      disableSslVerification();

      if (System.getProperty("athenz.zpe.jwk_uri") == null) {
        System.setProperty("athenz.zpe.jwk_uri", DEFAULT_JWK_URI);
      }
      if (System.getProperty("athenz.zpe.policy_dir") == null) {
        System.setProperty("athenz.zpe.policy_dir", "./policies");
      }
      if (System.getProperty("athenz.zpe.monitor_timeout_secs") == null) {
        System.setProperty("athenz.zpe.monitor_timeout_secs", "5");
      }
      if (System.getProperty("athenz.zpe.skip_policy_dir_check") == null) {
        System.setProperty("athenz.zpe.skip_policy_dir_check", "false");
      }
      if (System.getProperty("athenz.zpe.check_policy_zms_signature") == null) {
        System.setProperty("athenz.zpe.check_policy_zms_signature", "false");
      }
      AuthZpeClient.init();
    }
  }

  public boolean isRequired() {
    return this.isRequired;
  }

  private String getAction(HttpExchange exchange) {
    String method = exchange.getRequestMethod();

    switch (method.toUpperCase()) {
      case "GET":
        return "get";
      case "POST":
        return "post";
      case "PUT":
        return "put";
      case "PATCH":
        return "patch";
      case "DELETE":
        return "delete";
      default:
        throw new IllegalArgumentException("Invalid HTTP method: " + method);
    }
  }

  public void authorizeRequest(HttpExchange exchange, String resource) {
    if (!this.isRequired) {
      return;
    }

    String authHeader = exchange.getRequestHeaders().getFirst("Authorization");
    String token = (authHeader != null && authHeader.startsWith("Bearer "))
        ? authHeader.substring(7)
        : null;

    if (token == null || token.isEmpty()) {
      throw new IllegalArgumentException("Authorization header is missing or invalid Bearer token.");
    }
    
    String action = getAction(exchange);
    AuthZpeClient.AccessCheckStatus status = AuthZpeClient.allowAccess(token, resource, action);

    if (status != AuthZpeClient.AccessCheckStatus.ALLOW) {
      throw new SecurityException(String.format("Token does not have '%s' action on '%s'", action, resource));
    }

    String timestamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    String safeToken = token.length() > 10 ? token.substring(0, 10) + "..." : token;

    System.out.println(String.format("[%s] [DEBUG] Access Granted: Action '%s' allowed on Resource '%s' (Token: %s)", 
        timestamp, action, resource, safeToken));
  }
}
