package zts

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const (
	testGenAIScope = "gen-ai.services.athenz:role.gen-ai-users"
	testDocsScope  = "gen-ai.services.athenz:role.docs-reader"
)

func TestExchangeIDJAGAllScopes(t *testing.T) {
	token := fakeIDJAGJWT(t, map[string]any{
		"sub": "human.idjag-learner",
		"scp": []string{testGenAIScope, testDocsScope, "gen-ai.services.athenz:role.extra"},
	})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/zts/v1/.well-known/openid-configuration":
			fmt.Fprint(w, `{"issuer":"https://athenz-zts-server.athenz:4443/zts/v1"}`)
		case "/zts/v1/oauth2/token":
			if err := r.ParseForm(); err != nil {
				t.Fatal(err)
			}
			wantScope := testDocsScope + " " + testGenAIScope
			want := map[string]string{
				"grant_type":           idJAGGrantType,
				"requested_token_type": idJAGTokenType,
				"subject_token_type":   idTokenSubjectType,
				"subject_token":        "header.payload.signature",
				"scope":                wantScope,
				"audience":             "https://athenz-zts-server.athenz:4443/zts/v1",
			}
			for key, value := range want {
				if r.Form.Get(key) != value {
					t.Errorf("%s=%q want=%q", key, r.Form.Get(key), value)
				}
			}
			if r.Header.Get("Authorization") != "" {
				t.Fatal("subject token leaked into Authorization header")
			}
			json.NewEncoder(w).Encode(map[string]any{
				"access_token": token,
				"token_type":   "N_A",
				"expires_in":   7200,
				"scope":        wantScope,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, err := NewClientWithHTTPClient(server.URL+"/zts/v1", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	idJAG, err := client.ExchangeIDJAG(context.Background(), "header.payload.signature",
		testGenAIScope+" "+testDocsScope+" "+testGenAIScope)
	if err != nil {
		t.Fatal(err)
	}
	if idJAG.AccessToken != token || idJAG.TokenType != "N_A" || idJAG.ExpiresIn != 7200 ||
		!containsAllScopes(uniqueScopes(idJAG.Scope), []string{testGenAIScope, testDocsScope}) {
		t.Fatalf("unexpected ID-JAG: %+v", idJAG)
	}
}

func TestExchangeIDJAGValidationAndResponseErrors(t *testing.T) {
	client, _ := NewClientWithHTTPClient("https://zts.example.test/zts/v1", http.DefaultClient)
	if _, err := client.ExchangeIDJAG(context.Background(), " ", testGenAIScope); err == nil || !strings.Contains(err.Error(), "subject ID token") {
		t.Fatalf("expected subject error, got %v", err)
	}
	if _, err := client.ExchangeIDJAG(context.Background(), "token", " "); err == nil || !strings.Contains(err.Error(), "scope") {
		t.Fatalf("expected scope error, got %v", err)
	}
	metadataServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "metadata unavailable", http.StatusServiceUnavailable)
	}))
	defer metadataServer.Close()
	metadataClient, _ := NewClientWithHTTPClient(metadataServer.URL, metadataServer.Client())
	if _, err := metadataClient.ExchangeIDJAG(context.Background(), "token", testGenAIScope); err == nil || !strings.Contains(err.Error(), "metadata unavailable") {
		t.Fatalf("expected metadata error, got %v", err)
	}

	tests := []struct {
		name     string
		response string
		status   int
		want     string
	}{
		{"status message", `{"message":"not authorized"}`, http.StatusForbidden, "not authorized"},
		{"status plain", `plain failure`, http.StatusBadRequest, "plain failure"},
		{"bad json", `{`, http.StatusOK, "decoding ZTS ID-JAG response"},
		{"missing token", `{}`, http.StatusOK, "did not contain access_token"},
		{"bad jwt", `{"access_token":"bad"}`, http.StatusOK, "decoding issued ID-JAG"},
		{"missing jwt scope", tokenResponseJSON(t, map[string]any{"sub": "human.alice"}, testGenAIScope), http.StatusOK, "did not contain scp or scope"},
		{"wrong jwt scope", tokenResponseJSON(t, map[string]any{"scope": "other:role.scope"}, testGenAIScope), http.StatusOK, "do not contain all requested"},
		{"wrong response scope", tokenResponseJSON(t, map[string]any{"scope": testGenAIScope}, "other:role.scope"), http.StatusOK, "response scope"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := newIDJAGServer(test.status, test.response)
			defer server.Close()
			client, _ := NewClientWithHTTPClient(server.URL, server.Client())
			_, err := client.ExchangeIDJAG(context.Background(), "token", testGenAIScope)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q, got %v", test.want, err)
			}
		})
	}
}

func TestOpenIDIssuerErrors(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{"status", http.StatusServiceUnavailable, `{"message":"starting"}`, "starting"},
		{"bad json", http.StatusOK, `{`, "decoding ZTS OpenID configuration"},
		{"missing issuer", http.StatusOK, `{}`, "did not contain issuer"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				fmt.Fprint(w, test.body)
			}))
			defer server.Close()
			client, _ := NewClientWithHTTPClient(server.URL, server.Client())
			_, err := client.openIDIssuer(context.Background())
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q, got %v", test.want, err)
			}
		})
	}

	client, _ := NewClientWithHTTPClient("http://127.0.0.1:1", http.DefaultClient)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := client.openIDIssuer(ctx); err == nil || !strings.Contains(err.Error(), "retrieving") {
		t.Fatalf("expected metadata transport error, got %v", err)
	}
	readClient := &Client{baseURL: "https://zts.example.test", httpClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(errorReader{})}, nil
	})}}
	if _, err := readClient.openIDIssuer(context.Background()); err == nil || !strings.Contains(err.Error(), "reading ZTS OpenID") {
		t.Fatalf("expected metadata read error, got %v", err)
	}
}

func TestIDJAGTransportAndReadErrors(t *testing.T) {
	requests := 0
	client := &Client{baseURL: "https://zts.example.test", httpClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		requests++
		if requests == 1 {
			return idJAGHTTPResponse(http.StatusOK, `{"issuer":"https://issuer.example.test"}`), nil
		}
		return nil, fmt.Errorf("exchange transport")
	})}}
	if _, err := client.ExchangeIDJAG(context.Background(), "token", testGenAIScope); err == nil || !strings.Contains(err.Error(), "exchanging ID token") {
		t.Fatalf("expected exchange transport error, got %v", err)
	}

	requests = 0
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		requests++
		if requests == 1 {
			return idJAGHTTPResponse(http.StatusOK, `{"issuer":"https://issuer.example.test"}`), nil
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(errorReader{})}, nil
	})
	if _, err := client.ExchangeIDJAG(context.Background(), "token", testGenAIScope); err == nil || !strings.Contains(err.Error(), "reading ZTS ID-JAG") {
		t.Fatalf("expected exchange read error, got %v", err)
	}
}

func TestNewIdentityClient(t *testing.T) {
	if _, err := NewIdentityClient("https://zts.example.test", "", "~somebody/cert", "key"); err == nil || !strings.Contains(err.Error(), "resolving identity certificate") {
		t.Fatalf("expected cert path error, got %v", err)
	}
	if _, err := NewIdentityClient("https://zts.example.test", "", "cert", "~somebody/key"); err == nil || !strings.Contains(err.Error(), "resolving identity private key") {
		t.Fatalf("expected key path error, got %v", err)
	}
	if _, err := NewIdentityClient("https://zts.example.test", "", filepath.Join(t.TempDir(), "missing"), "missing"); err == nil || !strings.Contains(err.Error(), "loading identity") {
		t.Fatalf("expected pair load error, got %v", err)
	}

	certPath, keyPath := writeIDJAGClientPair(t)
	if _, err := NewIdentityClient("https://zts.example.test", filepath.Join(t.TempDir(), "missing-ca"), certPath, keyPath); err == nil || !strings.Contains(err.Error(), "reading Athenz ca_file") {
		t.Fatalf("expected CA error, got %v", err)
	}
	client, err := NewIdentityClient("https://zts.example.test", "", certPath, keyPath)
	if err != nil {
		t.Fatal(err)
	}
	transport, ok := client.httpClient.Transport.(*http.Transport)
	if !ok || transport.TLSClientConfig.MinVersion != tls12Version || len(transport.TLSClientConfig.Certificates) != 1 {
		t.Fatalf("unexpected identity transport: %#v", client.httpClient.Transport)
	}

	_, _, caPEM := newTestCA(t)
	caPath := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(caPath, caPEM, 0600); err != nil {
		t.Fatal(err)
	}
	client, err = NewIdentityClient("https://zts.example.test", caPath, certPath, keyPath)
	if err != nil {
		t.Fatal(err)
	}
	transport, ok = client.httpClient.Transport.(*http.Transport)
	if !ok || transport.TLSClientConfig.RootCAs == nil || len(transport.TLSClientConfig.Certificates) != 1 {
		t.Fatalf("unexpected CA-configured transport: %#v", client.httpClient.Transport)
	}
}

func TestIDJAGScopeHelpers(t *testing.T) {
	want := []string{"a", "b"}
	if got := uniqueScopes("b a b"); !reflect.DeepEqual(got, want) {
		t.Fatalf("uniqueScopes=%v", got)
	}
	if !containsAllScopes([]string{"a", "b", "c"}, want) || containsAllScopes([]string{"a"}, want) {
		t.Fatal("containsAllScopes mismatch")
	}
	if scopes, err := tokenScopes(map[string]any{"scope": "b a"}); err != nil || !reflect.DeepEqual(scopes, want) {
		t.Fatalf("string scopes=%v err=%v", scopes, err)
	}
	if scopes, err := tokenScopes(map[string]any{"scp": []any{}, "scope": "a"}); err != nil || !reflect.DeepEqual(scopes, []string{"a"}) {
		t.Fatalf("fallback scopes=%v err=%v", scopes, err)
	}
	for _, claims := range []map[string]any{
		{"scp": []any{"a", 2}},
		{"scp": 2},
		{"scope": ""},
	} {
		if _, err := tokenScopes(claims); err == nil {
			t.Fatalf("expected scope error for %#v", claims)
		}
	}
	if !strings.Contains((&TokenExchangeError{StatusCode: 500}).Error(), "HTTP 500") ||
		!strings.Contains((&TokenExchangeError{StatusCode: 400, Message: "bad"}).Error(), "bad") ||
		!strings.Contains(tokenExchangeStatus(400, nil).Error(), "HTTP 400") {
		t.Fatal("token exchange error formatting mismatch")
	}
}

const tls12Version = 0x0303

func newIDJAGServer(status int, tokenResponse string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/.well-known/openid-configuration") {
			fmt.Fprint(w, `{"issuer":"https://issuer.example.test"}`)
			return
		}
		w.WriteHeader(status)
		fmt.Fprint(w, tokenResponse)
	}))
}

func fakeIDJAGJWT(t *testing.T, claims map[string]any) string {
	t.Helper()
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "oauth-id-jag+jwt"})
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload) + ".signature"
}

func tokenResponseJSON(t *testing.T, claims map[string]any, responseScope string) string {
	t.Helper()
	value, err := json.Marshal(map[string]any{"access_token": fakeIDJAGJWT(t, claims), "scope": responseScope})
	if err != nil {
		t.Fatal(err)
	}
	return string(value)
}

func idJAGHTTPResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body))}
}

func writeIDJAGClientPair(t *testing.T) (string, string) {
	t.Helper()
	caKey, caCertificate, _ := newTestCA(t)
	clientKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	certPEM := certificateForPublicKey(t, caKey, caCertificate, &clientKey.PublicKey, "home.alice.local.athenzd")
	keyPEM := pemEncodePKCS1(clientKey)
	directory := t.TempDir()
	certPath := filepath.Join(directory, "service.cert.pem")
	keyPath := filepath.Join(directory, "service.key.pem")
	if err := os.WriteFile(certPath, certPEM, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, keyPEM, 0600); err != nil {
		t.Fatal(err)
	}
	return certPath, keyPath
}

func pemEncodePKCS1(key *rsa.PrivateKey) []byte {
	return []byte("-----BEGIN RSA PRIVATE KEY-----\n" +
		base64.StdEncoding.EncodeToString(x509.MarshalPKCS1PrivateKey(key)) +
		"\n-----END RSA PRIVATE KEY-----\n")
}
