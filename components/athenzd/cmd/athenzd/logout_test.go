package main

import (
	"bytes"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/AthenZ/athenzd/internal/cache"
)

func TestLogoutCmd_ClearsCacheAndOpensIdPLogout(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	configPath := writeLogoutConfig(t, home, "current_service: alice", "https://idp.example.test/realms/master")
	if err := cache.Save("alice", cache.TokenEntry{IDToken: "signed.id.token"}); err != nil {
		t.Fatal(err)
	}

	var opened string
	cmd := newLogoutCmdWithBrowser(func(rawURL string) error {
		opened = rawURL
		return nil
	})
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	cmd.SetOut(stdout)
	cmd.SetErr(stderr)
	cmd.SetArgs([]string{"-f", configPath})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("logout failed: %v", err)
	}

	parsed, err := url.Parse(opened)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Path != "/realms/master/protocol/openid-connect/logout" ||
		parsed.Query().Get("client_id") != "athenzd" ||
		parsed.Query().Get("id_token_hint") != "signed.id.token" {
		t.Fatalf("unexpected logout URL: %s", opened)
	}
	if _, err := cache.Load("alice"); err == nil {
		t.Fatal("expected cached credentials to be deleted")
	}
	if !strings.Contains(stdout.String(), `Cached credentials cleared for current_service "alice"`) ||
		!strings.Contains(stdout.String(), "Identity-provider logout opened in the browser") {
		t.Fatalf("unexpected stdout: %q", stdout.String())
	}
	if strings.Contains(stdout.String(), "signed.id.token") || strings.Contains(stderr.String(), "signed.id.token") {
		t.Fatal("logout output must not expose the ID token")
	}
	if !strings.Contains(stderr.String(), "config: "+configPath) {
		t.Fatalf("expected config source on stderr, got %q", stderr.String())
	}
}

func TestLogoutCmd_NoCacheStillOpensIdPLogout(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	configPath := writeLogoutConfig(t, home, "current_service: alice", "https://idp.example.test/realms/master/")

	var opened string
	cmd := newLogoutCmdWithBrowser(func(rawURL string) error {
		opened = rawURL
		return nil
	})
	stdout := &bytes.Buffer{}
	cmd.SetOut(stdout)
	cmd.SetArgs([]string{"-f", configPath})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("logout failed: %v", err)
	}
	parsed, err := url.Parse(opened)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Query().Has("id_token_hint") {
		t.Fatalf("unexpected ID-token hint without a cache: %s", opened)
	}
	if !strings.Contains(stdout.String(), `No cached credentials found for current_service "alice"`) {
		t.Fatalf("unexpected stdout: %q", stdout.String())
	}
}

func TestLogoutCmd_BrowserFailureLeavesLocalCredentialsCleared(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	configPath := writeLogoutConfig(t, home, "current_service: alice", "https://idp.example.test/realms/master")
	if err := cache.Save("alice", cache.TokenEntry{IDToken: "token"}); err != nil {
		t.Fatal(err)
	}

	cmd := newLogoutCmdWithBrowser(func(string) error { return errors.New("browser unavailable") })
	cmd.SetArgs([]string{"-f", configPath})
	err := cmd.Execute()
	if err == nil || !strings.Contains(err.Error(), "local credentials were cleared") {
		t.Fatalf("expected partial-logout error, got %v", err)
	}
	if _, err := cache.Load("alice"); err == nil {
		t.Fatal("local credentials must remain cleared when browser opening fails")
	}
}

func TestLogoutCmd_ValidationErrors(t *testing.T) {
	t.Run("config resolve", func(t *testing.T) {
		t.Setenv("HOME", "")
		cmd := newLogoutCmdWithBrowser(func(string) error { return nil })
		if err := cmd.Execute(); err == nil {
			t.Fatal("expected config resolve error")
		}
	})

	t.Run("config load", func(t *testing.T) {
		cmd := newLogoutCmdWithBrowser(func(string) error { return nil })
		cmd.SetArgs([]string{"-f", filepath.Join(t.TempDir(), "missing.yaml")})
		if err := cmd.Execute(); err == nil {
			t.Fatal("expected config load error")
		}
	})

	t.Run("current service", func(t *testing.T) {
		home := t.TempDir()
		t.Setenv("HOME", home)
		path := writeLogoutConfig(t, home, "current_service: \"\"", "https://idp.example.test/realms/master")
		cmd := newLogoutCmdWithBrowser(func(string) error { return nil })
		cmd.SetArgs([]string{"-f", path})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "current_service") {
			t.Fatalf("expected current_service error, got %v", err)
		}
	})

	t.Run("service missing", func(t *testing.T) {
		home := t.TempDir()
		t.Setenv("HOME", home)
		path := writeLogoutConfig(t, home, "current_service: missing", "https://idp.example.test/realms/master")
		cmd := newLogoutCmdWithBrowser(func(string) error { return nil })
		cmd.SetArgs([]string{"-f", path})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), `service "missing" not found`) {
			t.Fatalf("expected missing service error, got %v", err)
		}
	})

	t.Run("issuer", func(t *testing.T) {
		home := t.TempDir()
		t.Setenv("HOME", home)
		path := writeLogoutConfig(t, home, "current_service: alice", "not-an-absolute-url")
		cmd := newLogoutCmdWithBrowser(func(string) error { return nil })
		cmd.SetArgs([]string{"-f", path})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "not an absolute URL") {
			t.Fatalf("expected issuer error, got %v", err)
		}
	})

	t.Run("cache delete", func(t *testing.T) {
		home := t.TempDir()
		path := writeLogoutConfig(t, home, "current_service: alice", "https://idp.example.test/realms/master")
		t.Setenv("HOME", "")
		cmd := newLogoutCmdWithBrowser(func(string) error { return nil })
		cmd.SetArgs([]string{"-f", path})
		if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "clearing cached credentials") {
			t.Fatalf("expected cache deletion error, got %v", err)
		}
	})
}

func TestIDPLogoutURL_ParseError(t *testing.T) {
	if _, err := idpLogoutURL("https://idp.example.test/%", "athenzd", ""); err == nil ||
		!strings.Contains(err.Error(), "building identity-provider logout URL") {
		t.Fatalf("expected URL parsing error, got %v", err)
	}
}

func writeLogoutConfig(t *testing.T, directory, currentService, issuer string) string {
	t.Helper()
	path := filepath.Join(directory, "config.yaml")
	content := `athenz:
  zts: https://zts.example.test/zts/v1
  zms: https://zms.example.test/zms/v1
` + currentService + `
services:
  - name: alice
    athenz:
      service: home.{{.preferred_username}}.local.athenzd
    idp:
      issuer: ` + issuer + `
      client_id: athenzd
      callback_port: 8250
`
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}
