package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
)

// TestHumanizeRemaining covers the friendly remaining-time formatting for each bucket.
func TestHumanizeRemaining(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		exp  time.Time
		want string
	}{
		{"hours", now.Add(3 * time.Hour), "~3h left"},
		{"minutes", now.Add(45 * time.Minute), "~45m left"},
		{"under a minute", now.Add(30 * time.Second), "~<1m left"},
		{"expired", now.Add(-time.Minute), "expired"},
		{"exactly now", now, "expired"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := humanizeRemaining(tc.exp, now); got != tc.want {
				t.Errorf("humanizeRemaining(%v) = %q, want %q", tc.exp.Sub(now), got, tc.want)
			}
		})
	}
}

func TestEnsureState(t *testing.T) {
	if got := ensureState(true); got != "created" {
		t.Fatalf("ensureState(true) = %q", got)
	}
	if got := ensureState(false); got != "already exists" {
		t.Fatalf("ensureState(false) = %q", got)
	}
	if got := membershipState(true); got != "added" {
		t.Fatalf("membershipState(true) = %q", got)
	}
	if got := membershipState(false); got != "already present" {
		t.Fatalf("membershipState(false) = %q", got)
	}
}

// TestFindService_Found checks that findService returns the matching service.
func TestFindService_Found(t *testing.T) {
	cfg := &config.Config{
		Services: []config.ServiceConfig{
			{Name: "svc-a"},
			{Name: "svc-b"},
		},
	}
	svc, err := findService(cfg, "svc-b")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if svc.Name != "svc-b" {
		t.Errorf("unexpected service name: %q", svc.Name)
	}
}

// TestFindService_NotFound checks that findService returns an error for an unknown service.
func TestFindService_NotFound(t *testing.T) {
	cfg := &config.Config{
		Services: []config.ServiceConfig{{Name: "svc-a"}},
	}
	_, err := findService(cfg, "svc-z")
	if err == nil {
		t.Fatal("expected error for unknown service, got nil")
	}
}

// TestOpenBrowser_UnsupportedOS checks that openBrowser errors on an unsupported OS.
// We can't test darwin/linux without actually launching a browser, so we test the fallback.
func TestOpenBrowser_UnsupportedOS(t *testing.T) {
	err := openBrowserForOS("plan9", "http://example.com")
	if err == nil {
		t.Fatal("expected error for unsupported OS, got nil")
	}
}

// TestOpenBrowserForOS_Linux checks that linux resolves to xdg-open (may fail if not installed, that's fine).
func TestOpenBrowserForOS_Linux(t *testing.T) {
	// We just check it doesn't return an "unsupported OS" error — xdg-open may not be installed.
	err := openBrowserForOS("linux", "http://example.com")
	if err != nil && err.Error() == "unsupported OS for browser open: linux" {
		t.Error("linux should not be unsupported OS")
	}
}

func TestOpenBrowserForOS_Windows(t *testing.T) {
	err := openBrowserForOS("windows", "http://example.com")
	if err != nil && err.Error() == "unsupported OS for browser open: windows" {
		t.Error("windows should not be unsupported OS")
	}
}

// TestLoginCmd_InvalidConfig checks that login fails when the config file is missing.
func TestLoginCmd_InvalidConfig(t *testing.T) {
	root := newLoginCmdWithBrowser(func(url string) error { return nil })
	root.SetArgs([]string{"-f", "/tmp/no-such-athenzd-config.yaml"})
	if err := root.Execute(); err == nil {
		t.Fatal("expected error for missing config file, got nil")
	}
}

// TestLoginCmd_ResolveError checks that login fails when HOME is unset and no -f flag.
func TestLoginCmd_ResolveError(t *testing.T) {
	t.Setenv("HOME", "")
	cmd := newRootCmd()
	cmd.SetArgs([]string{"login"})
	if err := cmd.Execute(); err == nil {
		t.Fatal("expected error when HOME is unset and no -f flag, got nil")
	}
}

// TestLoginCmd_ShowsSource checks that login prints the config source to stderr before attempting OIDC.
func TestLoginCmd_ShowsSource(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	// Mock OIDC server that immediately redirects back with an error so login.Run returns fast.
	oidc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/realms/master/protocol/openid-connect/auth" {
			redirect := r.URL.Query().Get("redirect_uri")
			http.Redirect(w, r, redirect+"?error=access_denied&state=wrong", http.StatusFound)
		}
	}))
	defer oidc.Close()

	path := writeTempConfig(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
current_service: svc-a
services:
  - name: svc-a
    athenz:
      service: home.mlajkim.local.athenzd
      provider: cloud.ynw.identityd
    idp:
      issuer: `+oidc.URL+`/realms/master
      client_id: athenzd
      callback_port: 0
`)
	root := newLoginCmdWithBrowser(func(url string) error {
		go http.Get(url) //nolint:noctx,errcheck
		return nil
	})
	errBuf := &bytes.Buffer{}
	root.SetErr(errBuf)
	root.SetArgs([]string{"-f", path})
	root.Execute() //nolint:errcheck
	if !strings.Contains(errBuf.String(), "explicit (-f flag)") {
		t.Errorf("expected source in stderr, got: %q", errBuf.String())
	}
}

// TestLoginCmd_MissingCurrentService checks that login fails when current_service is unset.
func TestLoginCmd_MissingCurrentService(t *testing.T) {
	path := writeTempConfig(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
services:
  - name: svc-a
    athenz:
      service: home.mlajkim.local.athenzd
      provider: cloud.ynw.identityd
    idp:
      issuer: https://localhost:34444/realms/master
      client_id: athenzd
`)
	cmd := newRootCmd()
	cmd.SetArgs([]string{"login", "-f", path})
	if err := cmd.Execute(); err == nil {
		t.Fatal("expected error for missing current_service, got nil")
	}
}

// TestLoginCmd_ServiceNotFound checks that login fails when current_service doesn't match any service.
func TestLoginCmd_ServiceNotFound(t *testing.T) {
	path := writeTempConfig(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
current_service: no-such-service
services:
  - name: svc-a
    athenz:
      service: home.mlajkim.local.athenzd
      provider: cloud.ynw.identityd
    idp:
      issuer: https://localhost:34444/realms/master
      client_id: athenzd
`)
	cmd := newRootCmd()
	cmd.SetArgs([]string{"login", "-f", path})
	if err := cmd.Execute(); err == nil {
		t.Fatal("expected error for service not found, got nil")
	}
}

func TestLoginCmd_MissingZMS(t *testing.T) {
	path := writeTempConfig(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
current_service: svc-a
services:
  - name: svc-a
    athenz:
      service: home.{{.preferred_username}}.local.athenzd
      optional_admins:
        - user.athenz_admin
      provider: sys.auth.zts
    idp:
      issuer: https://localhost:34444/realms/master
      client_id: athenzd
`)
	cmd := newRootCmd()
	cmd.SetArgs([]string{"login", "-f", path})
	err := cmd.Execute()
	if err == nil || !strings.Contains(err.Error(), "athenz.zms is required for login") {
		t.Fatalf("expected missing ZMS error, got %v", err)
	}
}

// TestLoginCmd_LoginFails checks that a login.Run failure is wrapped and returned.
func TestLoginCmd_LoginFails(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	// OIDC server that never responds to the callback — login times out.
	oidc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Auth endpoint redirects but with wrong state — causes login.Run to error.
		if r.URL.Path == "/realms/master/protocol/openid-connect/auth" {
			redirect := r.URL.Query().Get("redirect_uri")
			http.Redirect(w, r, redirect+"?error=access_denied&state=wrong", http.StatusFound)
		}
	}))
	defer oidc.Close()

	path := writeTempConfig(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
  zms: https://zms.example.com:4443/zms/v1
current_service: svc
services:
  - name: svc
    athenz:
      service: home.{{.preferred_username}}.local.athenzd
      optional_admins:
        - user.athenz_admin
      provider: sys.auth.zts
    idp:
      issuer: `+oidc.URL+`/realms/master
      client_id: athenzd
      callback_port: 0
`)

	root := newLoginCmdWithBrowser(func(url string) error {
		go http.Get(url) //nolint:noctx,errcheck
		return nil
	})
	root.SetArgs([]string{"-f", path})

	if err := root.Execute(); err == nil {
		t.Fatal("expected error from failed login.Run, got nil")
	}
}

// TestLoginCmd_Success runs the full login command against a mock OIDC server.
func TestLoginCmd_Success(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	idToken := fakeIDToken(`{"preferred_username":"idjag-learner","aud":"athenzd"}`)
	zmsServer := newExistingZMS(t, idToken)
	defer zmsServer.Close()

	oidc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/realms/master/protocol/openid-connect/auth":
			redirect := r.URL.Query().Get("redirect_uri")
			state := r.URL.Query().Get("state")
			http.Redirect(w, r, redirect+"?code=fake-code&state="+state, http.StatusFound)
		case "/realms/master/protocol/openid-connect/token":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"access_token": "fake-at",
				"id_token":     idToken,
				"token_type":   "Bearer",
				"expiry":       time.Now().Add(1 * time.Hour).Unix(),
			})
		}
	}))
	defer oidc.Close()

	path := writeTempConfig(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
  zms: `+zmsServer.URL+`/zms/v1
current_service: idjag-learner
services:
  - name: idjag-learner
    athenz:
      service: home.{{.preferred_username}}.local.athenzd
      optional_admins:
        - user.athenz_admin
      provider: sys.auth.zts
    idp:
      issuer: `+oidc.URL+`/realms/master
      client_id: athenzd
      callback_port: 0
`)

	root := newLoginCmdWithBrowser(func(url string) error {
		// Simulate the browser following the OIDC redirect.
		resp, err := http.Get(url) //nolint:noctx
		if err != nil {
			return err
		}
		resp.Body.Close()
		return nil
	})

	buf := &bytes.Buffer{}
	root.SetOut(buf)
	root.SetArgs([]string{"-f", path})

	if err := root.Execute(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(buf.String(), "ID token cached") {
		t.Errorf("expected login output, got: %q", buf.String())
	}
	if !strings.Contains(buf.String(), "Ready: home.idjag-learner.local.athenzd") {
		t.Errorf("expected ensured service in output, got: %q", buf.String())
	}
	if !strings.Contains(buf.String(), "Optional administrator user.athenz_admin: already present") {
		t.Errorf("expected optional administrator in output, got: %q", buf.String())
	}

	// Verify token was cached.
	entry, err := cache.Load("idjag-learner")
	if err != nil {
		t.Fatalf("expected cache to be written: %v", err)
	}
	if entry.IDToken != idToken {
		t.Errorf("unexpected cached IDToken: %q", entry.IDToken)
	}
}

// TestLoginCmd_CacheSaveError checks that a cache write failure is surfaced.
func TestLoginCmd_CacheSaveError(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	// Block cache writes by making the cache dir a file.
	cacheParent := filepath.Join(home, ".cache")
	if err := os.MkdirAll(cacheParent, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cacheParent, "athenzd"), []byte("i am a file"), 0600); err != nil {
		t.Fatal(err)
	}

	oidc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/realms/master/protocol/openid-connect/auth":
			redirect := r.URL.Query().Get("redirect_uri")
			state := r.URL.Query().Get("state")
			http.Redirect(w, r, redirect+"?code=fake-code&state="+state, http.StatusFound)
		case "/realms/master/protocol/openid-connect/token":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"access_token": "fake-at",
				"id_token":     fakeIDToken(`{"preferred_username":"idjag-learner","aud":"athenzd"}`),
				"token_type":   "Bearer",
			})
		}
	}))
	defer oidc.Close()

	path := writeTempConfig(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
  zms: https://zms.example.com:4443/zms/v1
current_service: svc
services:
  - name: svc
    athenz:
      service: home.{{.preferred_username}}.local.athenzd
      provider: sys.auth.zts
    idp:
      issuer: `+oidc.URL+`/realms/master
      client_id: athenzd
      callback_port: 0
`)

	root := newLoginCmdWithBrowser(func(url string) error {
		resp, err := http.Get(url) //nolint:noctx
		if err != nil {
			return err
		}
		resp.Body.Close()
		return nil
	})
	root.SetArgs([]string{"-f", path})

	err := root.Execute()
	if err == nil {
		t.Fatal("expected error for cache write failure, got nil")
	}
}

func TestLoginCmd_RejectsMalformedIDToken(t *testing.T) {
	err := runSuccessfulOIDCLogin(t, "not-a-jwt", "home.{{.preferred_username}}.local.athenzd", "https://zms.example.test/zms/v1", "")
	if err == nil || !strings.Contains(err.Error(), "reading identity from ID token") {
		t.Fatalf("expected malformed ID token error, got %v", err)
	}
}

func TestLoginCmd_RequiresPreferredUsername(t *testing.T) {
	token := fakeIDToken(`{"aud":"athenzd"}`)
	err := runSuccessfulOIDCLogin(t, token, "home.{{.preferred_username}}.local.athenzd", "https://zms.example.test/zms/v1", "")
	if err == nil || !strings.Contains(err.Error(), "preferred_username") {
		t.Fatalf("expected preferred_username error, got %v", err)
	}
}

func TestLoginCmd_RejectsInvalidServiceTemplate(t *testing.T) {
	token := fakeIDToken(`{"preferred_username":"idjag-learner","aud":"athenzd"}`)
	err := runSuccessfulOIDCLogin(t, token, "home.{{.unknown}}.local.athenzd", "https://zms.example.test/zms/v1", "")
	if err == nil || !strings.Contains(err.Error(), "deriving Athenz service from ID token") {
		t.Fatalf("expected service template error, got %v", err)
	}
}

func TestLoginCmd_RejectsInvalidZMSCA(t *testing.T) {
	token := fakeIDToken(`{"preferred_username":"idjag-learner","aud":"athenzd"}`)
	err := runSuccessfulOIDCLogin(t, token, "home.{{.preferred_username}}.local.athenzd", "https://zms.example.test/zms/v1", filepath.Join(t.TempDir(), "missing.pem"))
	if err == nil || !strings.Contains(err.Error(), "creating ZMS client") {
		t.Fatalf("expected ZMS client error, got %v", err)
	}
}

func TestLoginCmd_ReportsMissingHomeParent(t *testing.T) {
	zmsServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer zmsServer.Close()

	token := fakeIDToken(`{"preferred_username":"idjag-learner","aud":"athenzd"}`)
	err := runSuccessfulOIDCLogin(t, token, "home.{{.preferred_username}}.local.athenzd", zmsServer.URL+"/zms/v1", "")
	if err == nil || !strings.Contains(err.Error(), `required personal home domain "home.idjag-learner" does not exist`) {
		t.Fatalf("expected missing parent error, got %v", err)
	}
}

func runSuccessfulOIDCLogin(t *testing.T, idToken, serviceTemplate, zmsURL, zmsCAFile string) error {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	oidc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/realms/master/protocol/openid-connect/auth":
			redirect := r.URL.Query().Get("redirect_uri")
			state := r.URL.Query().Get("state")
			http.Redirect(w, r, redirect+"?code=fake-code&state="+state, http.StatusFound)
		case "/realms/master/protocol/openid-connect/token":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"access_token": "fake-at",
				"id_token":     idToken,
				"token_type":   "Bearer",
				"expiry":       time.Now().Add(time.Hour).Unix(),
			})
		}
	}))
	defer oidc.Close()

	path := writeTempConfig(t, `
athenz:
  zts: https://zts.example.test/zts/v1
  zms: `+zmsURL+`
  ca_file: `+zmsCAFile+`
current_service: idjag-learner
services:
  - name: idjag-learner
    athenz:
      service: `+serviceTemplate+`
      provider: sys.auth.zts
    idp:
      issuer: `+oidc.URL+`/realms/master
      client_id: athenzd
      callback_port: 0
`)

	root := newLoginCmdWithBrowser(func(url string) error {
		response, err := http.Get(url) //nolint:noctx
		if err != nil {
			return err
		}
		response.Body.Close()
		return nil
	})
	root.SetArgs([]string{"-f", path})
	return root.Execute()
}

func newExistingZMS(t *testing.T, idToken string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer "+idToken {
			t.Errorf("unexpected Authorization header: %q", got)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/zms/v1/domain/home.idjag-learner", "/zms/v1/domain/home.idjag-learner.local":
			fmt.Fprint(w, `{}`)
		case "/zms/v1/domain/home.idjag-learner.local/role/admin":
			fmt.Fprint(w, `{"roleMembers":[{"memberName":"user.athenz_admin"}]}`)
		case "/zms/v1/domain/home.idjag-learner.local/service/athenzd":
			fmt.Fprint(w, `{"name":"home.idjag-learner.local.athenzd"}`)
		default:
			http.NotFound(w, r)
		}
	}))
}

func writeTempConfig(t *testing.T, content string) string {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "athenzd-*.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString(content); err != nil {
		t.Fatal(err)
	}
	f.Close()
	return filepath.Clean(f.Name())
}
