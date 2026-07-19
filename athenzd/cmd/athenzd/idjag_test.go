package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
	"github.com/AthenZ/athenzd/internal/genai"
	"github.com/AthenZ/athenzd/internal/idjag"
	"github.com/AthenZ/athenzd/internal/zms"
)

const (
	testDomainTemplate = "gen-ai.services.{{project}}"
	testBaselineRole   = "gen-ai-users"
	testBaselineScope  = "gen-ai.services.athenz:role.gen-ai-users"
)

func TestIssueIDJAGs(t *testing.T) {
	idToken := fakeIDToken(`{"preferred_username":"alice"}`)
	zmsServer := newIDJAGZMSServer(t, http.StatusOK, true)
	defer zmsServer.Close()
	ztsServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/zts/v1/.well-known/openid-configuration":
			fmt.Fprint(w, `{"issuer":"https://issuer.example.test"}`)
		case "/zts/v1/oauth2/token":
			if err := r.ParseForm(); err != nil {
				t.Error(err)
			}
			scope := r.Form.Get("scope")
			token := fakeIDToken(`{"sub":"user.alice","scope":"` + scope + `"}`)
			json.NewEncoder(w).Encode(map[string]any{
				"access_token": token,
				"expires_in":   600,
				"scope":        scope,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer ztsServer.Close()
	certFile, keyFile := writeIDJAGClientPair(t)
	cfg := testIDJAGConfig(zmsServer.URL, ztsServer.URL+"/zts/v1", certFile, keyFile)
	target, _ := zms.ResolveTarget("home.{{.preferred_username}}.local.athenzd", "alice")
	var discovered []genai.ServiceScopes
	entries, err := issueIDJAGs(context.Background(), cfg, &cfg.Services[0], idToken, target, func(projects []genai.ServiceScopes) {
		discovered = projects
	})
	if err != nil {
		t.Fatal(err)
	}
	entry := entries["athenz"]
	if len(entries) != 1 || entry.Service != "athenz" || entry.Domain != "gen-ai.services.athenz" ||
		entry.Token == "" || entry.Scope != testBaselineScope || entry.ExpiresAt.Before(time.Now().Add(9*time.Minute)) {
		t.Fatalf("entries=%+v", entries)
	}
	if len(discovered) != 1 || len(discovered[0].Scopes) != 1 || discovered[0].Scopes[0] != testBaselineScope {
		t.Fatalf("discovered=%+v", discovered)
	}
	ordered := sortedIDJAGs(map[string]cache.IDJAGEntry{
		"mail":   {Service: "mail"},
		"athenz": {Service: "athenz"},
	})
	if len(ordered) != 2 || ordered[0].Service != "athenz" || len(scopeFields("a b")) != 2 {
		t.Fatalf("ordered=%+v", ordered)
	}
}

func TestIssueIDJAGsErrors(t *testing.T) {
	target, _ := zms.ResolveTarget("home.{{.preferred_username}}.local.athenzd", "alice")
	cfg := testIDJAGConfig("://bad", "https://zts.example.test", "missing", "missing")
	if _, err := issueIDJAGs(context.Background(), cfg, &cfg.Services[0], "token", target, nil); err == nil || !strings.Contains(err.Error(), "creating ZMS client") {
		t.Fatalf("expected client error, got %v", err)
	}

	for _, test := range []struct {
		name   string
		status int
		roles  bool
		want   string
	}{
		{"discovery", http.StatusForbidden, false, "discovering GenAI roles"},
		{"identity", http.StatusOK, true, "creating X.509-authenticated"},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := newIDJAGZMSServer(t, test.status, test.roles)
			defer server.Close()
			cfg := testIDJAGConfig(server.URL, "https://zts.example.test", "missing", "missing")
			_, err := issueIDJAGs(context.Background(), cfg, &cfg.Services[0], "token", target, nil)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q, got %v", test.want, err)
			}
		})
	}

	t.Run("exchange happens after roles are reported", func(t *testing.T) {
		zmsServer := newIDJAGZMSServer(t, http.StatusOK, true)
		defer zmsServer.Close()
		rolesReported := make(chan struct{})
		ztsServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/zts/v1/.well-known/openid-configuration":
				fmt.Fprint(w, `{"issuer":"https://issuer.example.test"}`)
			case "/zts/v1/oauth2/token":
				select {
				case <-rolesReported:
				default:
					t.Error("ID-JAG exchange started before roles were reported")
				}
				w.WriteHeader(http.StatusBadRequest)
				fmt.Fprint(w, `{"message":"Invalid subject token audience"}`)
			default:
				http.NotFound(w, r)
			}
		}))
		defer ztsServer.Close()
		certFile, keyFile := writeIDJAGClientPair(t)
		cfg := testIDJAGConfig(zmsServer.URL, ztsServer.URL+"/zts/v1", certFile, keyFile)
		_, err := issueIDJAGs(context.Background(), cfg, &cfg.Services[0], "token", target, func(projects []genai.ServiceScopes) {
			if len(projects) != 1 || projects[0].Scopes[0] != testBaselineScope {
				t.Fatalf("projects=%+v", projects)
			}
			close(rolesReported)
		})
		if err == nil || !strings.Contains(err.Error(), "Invalid subject token audience") {
			t.Fatalf("expected unchanged invalid-audience error, got %v", err)
		}
	})
}

func TestCacheLoginIDJAGsError(t *testing.T) {
	t.Setenv("HOME", "")
	entry := &cache.TokenEntry{IDToken: "token"}
	err := cacheLoginIDJAGs("profile", entry, map[string]cache.IDJAGEntry{"athenz": {Service: "athenz"}})
	if err == nil || !strings.Contains(err.Error(), "caching issued ID-JAGs") || len(entry.IDJAGs) != 1 {
		t.Fatalf("entry=%+v err=%v", entry, err)
	}
}

func TestIDJAGSkipLog(t *testing.T) {
	noEligible := &idjag.NoEligibleProjectsError{
		UserPrincipal:  "user.alice",
		DomainTemplate: "gen-ai.services.{{project}}",
	}
	if got := idJAGSkipLog(noEligible); !strings.Contains(got, "↷ ID-JAG skipped") || !strings.Contains(got, "user.alice") {
		t.Fatalf("unexpected no-role log: %q", got)
	}
	if got := idJAGSkipLog(fmt.Errorf("exchange unavailable")); !strings.Contains(got, "⚠ ID-JAG skipped") || !strings.Contains(got, "exchange unavailable") {
		t.Fatalf("unexpected failure log: %q", got)
	}
}

func TestFormatEligibleRoles(t *testing.T) {
	projects := []genai.ServiceScopes{
		{Domain: "gen-ai.services.athenz", Scopes: []string{"gen-ai.services.athenz:role.docs-reader", testBaselineScope}},
		{Domain: "gen-ai.services.mail", Scopes: []string{"gen-ai.services.mail:role.gen-ai-users"}},
	}
	lines := formatEligibleRoles("user.alice", projects)
	want := []string{
		"✓ Eligible roles for user.alice:",
		"  - gen-ai.services.athenz:role.docs-reader",
		"  - " + testBaselineScope,
		"  - gen-ai.services.mail:role.gen-ai-users",
	}
	if !reflect.DeepEqual(lines, want) {
		t.Fatalf("lines=%q want=%q", lines, want)
	}
}

func newIDJAGZMSServer(t *testing.T, status int, includeRoles bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if status != http.StatusOK {
			w.WriteHeader(status)
			fmt.Fprint(w, "denied")
			return
		}
		roles := []map[string]string{}
		switch {
		case includeRoles && r.URL.Path == "/role" && r.URL.Query().Get("principal") == "user.alice":
			roles = append(roles, map[string]string{"domainName": "gen-ai.services.athenz", "roleName": testBaselineRole})
			json.NewEncoder(w).Encode(map[string]any{"memberRoles": roles})
		case includeRoles && r.URL.Path == "/domain/gen-ai.services.athenz/member":
			json.NewEncoder(w).Encode(map[string]any{"members": []map[string]any{{
				"memberName":  "home.*",
				"memberRoles": []map[string]string{{"roleName": testBaselineRole + "-jag-exchanger"}},
			}}})
		default:
			json.NewEncoder(w).Encode(map[string]any{"memberRoles": roles})
		}
	}))
}

func testIDJAGConfig(zmsURL, ztsURL, certFile, keyFile string) *config.Config {
	return &config.Config{
		Athenz: config.AthenzCore{ZMS: zmsURL, ZTS: ztsURL},
		GenAI:  config.GenAIConfig{Domain: testDomainTemplate, Role: testBaselineRole},
		Services: []config.ServiceConfig{{
			IDP:      config.IDPConfig{ClientID: "athenzd"},
			Identity: config.IdentityConfig{CertFile: certFile, KeyFile: keyFile},
		}},
	}
}

func writeIDJAGClientPair(t *testing.T) (string, string) {
	t.Helper()
	caKey, caCertificate, _ := newLoginTestCA(t)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	csrDER, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{
		Subject: pkix.Name{CommonName: "home.alice.local.athenzd"},
	}, key)
	if err != nil {
		t.Fatal(err)
	}
	csr, err := x509.ParseCertificateRequest(csrDER)
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	certFile := filepath.Join(directory, "service.cert.pem")
	keyFile := filepath.Join(directory, "service.key.pem")
	certPEM := signLoginTestCSR(t, caKey, caCertificate, csr)
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	if err := os.WriteFile(certFile, certPEM, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyFile, keyPEM, 0600); err != nil {
		t.Fatal(err)
	}
	return certFile, keyFile
}
