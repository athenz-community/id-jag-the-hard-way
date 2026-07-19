package zms

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	testToken         = "header.payload.signature"
	testOptionalAdmin = "user.athenz_admin"
)

func TestResolveTarget(t *testing.T) {
	target, err := ResolveTarget(DefaultServiceTemplate, "idjag-learner")
	if err != nil {
		t.Fatalf("ResolveTarget: %v", err)
	}
	if target.PreferredUsername != "idjag-learner" ||
		target.UserPrincipal != "user.idjag-learner" ||
		target.ParentDomain != "home.idjag-learner" ||
		target.SubdomainName != "local" ||
		target.Domain != "home.idjag-learner.local" ||
		target.ServiceName != "athenzd" ||
		target.ServiceIdentity != "home.idjag-learner.local.athenzd" {
		t.Fatalf("unexpected target: %+v", target)
	}
}

func TestResolveTargetErrors(t *testing.T) {
	tests := []struct {
		name     string
		service  string
		username string
		want     string
	}{
		{"invalid username", DefaultServiceTemplate, "bad.user", "not a valid Athenz simple name"},
		{"parse template", "home.{{", "alice", "parsing athenz.service"},
		{"render template", "home.{{.unknown}}.local.athenzd", "alice", "rendering athenz.service"},
		{"no service separator", "athenzd", "alice", "must contain a domain and service name"},
		{"empty service", "home.{{.preferred_username}}.local.", "alice", "must contain a domain and service name"},
		{"invalid service", "home.{{.preferred_username}}.local.bad+service", "alice", "service name"},
		{"no parent", "{{.preferred_username}}.athenzd", "alice", "must contain a parent domain"},
		{"wrong parent", "other.{{.preferred_username}}.local.athenzd", "alice", "must be directly under"},
		{"invalid subdomain", "home.{{.preferred_username}}.bad+name.athenzd", "alice", "subdomain name"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ResolveTarget(test.service, test.username)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q error, got %v", test.want, err)
			}
		})
	}
}

func TestEnsureCreatesMissingChildren(t *testing.T) {
	state := &zmsState{parentExists: true}
	server := newZMSServer(t, state)
	defer server.Close()

	client, err := NewClientWithHTTPClient(server.URL+"/zms/v1/", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	target := mustTarget(t)
	report, err := client.Ensure(context.Background(), testToken, target, []string{testOptionalAdmin})
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if !report.SubdomainCreated || len(report.OptionalAdmins) != 1 || report.OptionalAdmins[0].Added || !report.ServiceCreated {
		t.Fatalf("expected subdomain and service creation: %+v", report)
	}
	if !state.subdomainExists || !state.adminExists || !state.serviceExists {
		t.Fatalf("server state was not completed: %+v", state)
	}
}

func TestEnsureAddsMissingAdmin(t *testing.T) {
	state := &zmsState{parentExists: true, subdomainExists: true, serviceExists: true}
	server := newZMSServer(t, state)
	defer server.Close()
	client, err := NewClientWithHTTPClient(server.URL+"/zms/v1", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	report, err := client.Ensure(context.Background(), testToken, mustTarget(t), []string{testOptionalAdmin})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.OptionalAdmins) != 1 || !report.OptionalAdmins[0].Added || !state.adminExists {
		t.Fatalf("expected administrator addition: report=%+v state=%+v", report, state)
	}
}

func TestEnsureAlreadyExists(t *testing.T) {
	state := &zmsState{parentExists: true, subdomainExists: true, adminExists: true, serviceExists: true}
	server := newZMSServer(t, state)
	defer server.Close()

	client, err := NewClientWithHTTPClient(server.URL+"/zms/v1", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	report, err := client.Ensure(context.Background(), testToken, mustTarget(t), []string{testOptionalAdmin})
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if report.SubdomainCreated || len(report.OptionalAdmins) != 1 || report.OptionalAdmins[0].Added || report.ServiceCreated {
		t.Fatalf("expected idempotent report: %+v", report)
	}
}

func TestEnsureWithoutOptionalAdmins(t *testing.T) {
	state := &zmsState{parentExists: true, subdomainExists: true, serviceExists: true}
	server := newZMSServer(t, state)
	defer server.Close()

	client, err := NewClientWithHTTPClient(server.URL+"/zms/v1", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	report, err := client.Ensure(context.Background(), testToken, mustTarget(t), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.OptionalAdmins) != 0 || state.adminExists {
		t.Fatalf("expected no optional administrator changes: report=%+v state=%+v", report, state)
	}
}

func TestNormalizeOptionalAdmins(t *testing.T) {
	admins, err := normalizeOptionalAdmins("user.alice", []string{
		" user.athenz_admin ",
		"user.athenz_admin",
		"user.alice",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(admins) != 1 || admins[0] != testOptionalAdmin {
		t.Fatalf("unexpected normalized administrators: %v", admins)
	}

	client, err := NewClientWithHTTPClient("https://zms.example.test/zms/v1", http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Ensure(context.Background(), testToken, mustTarget(t), []string{"bad/admin"})
	if err == nil || !strings.Contains(err.Error(), "not a valid Athenz member name") {
		t.Fatalf("expected invalid optional administrator error, got %v", err)
	}
}

func TestEnsureRequiredParentMissing(t *testing.T) {
	server := newZMSServer(t, &zmsState{})
	defer server.Close()
	client, err := NewClientWithHTTPClient(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Ensure(context.Background(), testToken, mustTarget(t), nil)
	if err == nil || !strings.Contains(err.Error(), `required personal home domain "home.idjag-learner" does not exist`) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestEnsureRequiresToken(t *testing.T) {
	client, err := NewClientWithHTTPClient("https://zms.example.com/zms/v1", http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Ensure(context.Background(), " ", mustTarget(t), nil)
	if err == nil || !strings.Contains(err.Error(), "ID token is required") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestClientValidation(t *testing.T) {
	for _, baseURL := range []string{"", "://bad", "ftp://zms.example.com"} {
		if _, err := NewClientWithHTTPClient(baseURL, http.DefaultClient); err == nil {
			t.Fatalf("expected invalid URL error for %q", baseURL)
		}
	}
	if _, err := NewClientWithHTTPClient("https://zms.example.com", nil); err == nil {
		t.Fatal("expected nil HTTP client error")
	}
}

func TestNewHTTPClient(t *testing.T) {
	client, err := newHTTPClient("")
	if err != nil || client.Timeout == 0 {
		t.Fatalf("default HTTP client: client=%v err=%v", client, err)
	}
	if _, err := newHTTPClient(filepath.Join(t.TempDir(), "missing.pem")); err == nil {
		t.Fatal("expected missing CA error")
	}
	invalidCA := filepath.Join(t.TempDir(), "invalid.pem")
	if err := os.WriteFile(invalidCA, []byte("not a certificate"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := newHTTPClient(invalidCA); err == nil {
		t.Fatal("expected invalid CA error")
	}

	tlsServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, "ok")
	}))
	defer tlsServer.Close()
	certificate, err := x509.ParseCertificate(tlsServer.Certificate().Raw)
	if err != nil {
		t.Fatal(err)
	}
	caFile := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(caFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate.Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	client, err = newHTTPClient(caFile)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.Get(tlsServer.URL)
	if err != nil {
		t.Fatalf("custom CA request: %v", err)
	}
	response.Body.Close()

	if _, err := NewClient("https://zms.example.com", caFile); err != nil {
		t.Fatalf("NewClient with CA: %v", err)
	}
}

func TestResponseHelpers(t *testing.T) {
	if err := unexpectedStatus("operation", 500, nil); !strings.Contains(err.Error(), "HTTP 500") {
		t.Fatalf("unexpected empty-body error: %v", err)
	}
	if err := unexpectedStatus("operation", 400, []byte(" bad ")); !strings.Contains(err.Error(), "bad") {
		t.Fatalf("unexpected body error: %v", err)
	}

	present, err := roleContains([]byte(`{"roleMembers":[{"memberName":"user.athenz_admin"}]}`), testOptionalAdmin)
	if err != nil || !present {
		t.Fatalf("roleMembers lookup: present=%v err=%v", present, err)
	}
	present, err = roleContains([]byte(`{"members":["user.athenz_admin"]}`), testOptionalAdmin)
	if err != nil || !present {
		t.Fatalf("members lookup: present=%v err=%v", present, err)
	}
	present, err = roleContains([]byte(`{}`), testOptionalAdmin)
	if err != nil || present {
		t.Fatalf("empty role lookup: present=%v err=%v", present, err)
	}
	if _, err := roleContains([]byte(`not-json`), testOptionalAdmin); err == nil {
		t.Fatal("expected role decode error")
	}

	if _, err := verifyServiceName([]byte(`{"name":"wrong"}`), "expected"); err == nil {
		t.Fatal("expected service mismatch")
	}
	if _, err := verifyServiceName([]byte(`not-json`), "expected"); err == nil {
		t.Fatal("expected service decode error")
	}
}

func mustTarget(t *testing.T) Target {
	t.Helper()
	target, err := ResolveTarget(DefaultServiceTemplate, "idjag-learner")
	if err != nil {
		t.Fatal(err)
	}
	return target
}

type zmsState struct {
	parentExists    bool
	subdomainExists bool
	adminExists     bool
	serviceExists   bool
}

func newZMSServer(t *testing.T, state *zmsState) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+testToken {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/zms/v1/domain/home.idjag-learner":
			writeExists(w, state.parentExists, `{}`)
		case r.Method == http.MethodGet && r.URL.Path == "/zms/v1/domain/home.idjag-learner.local":
			writeExists(w, state.subdomainExists, `{}`)
		case r.Method == http.MethodPost && r.URL.Path == "/zms/v1/subdomain/home.idjag-learner":
			var body struct {
				Parent     string   `json:"parent"`
				Name       string   `json:"name"`
				AdminUsers []string `json:"adminUsers"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Parent != "home.idjag-learner" || body.Name != "local" || len(body.AdminUsers) != 2 {
				t.Errorf("unexpected subdomain request: %+v err=%v", body, err)
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			state.subdomainExists = true
			state.adminExists = true
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodGet && r.URL.Path == "/zms/v1/domain/home.idjag-learner.local/role/admin":
			if !state.subdomainExists {
				http.NotFound(w, r)
				return
			}
			if state.adminExists {
				fmt.Fprint(w, `{"roleMembers":[{"memberName":"user.athenz_admin"}]}`)
			} else {
				fmt.Fprint(w, `{"roleMembers":[]}`)
			}
		case r.Method == http.MethodPut && r.URL.Path == "/zms/v1/domain/home.idjag-learner.local/role/admin/member/user.athenz_admin":
			state.adminExists = true
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodGet && r.URL.Path == "/zms/v1/domain/home.idjag-learner.local/service/athenzd":
			writeExists(w, state.serviceExists, `{"name":"home.idjag-learner.local.athenzd"}`)
		case r.Method == http.MethodPut && r.URL.Path == "/zms/v1/domain/home.idjag-learner.local/service/athenzd":
			state.serviceExists = true
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
}

func writeExists(w http.ResponseWriter, exists bool, body string) {
	if !exists {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	fmt.Fprint(w, body)
}
