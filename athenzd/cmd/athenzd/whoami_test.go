package main

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/AthenZ/athenzd/internal/cache"
)

// fakeIDToken builds a JWT whose payload carries the given claims JSON.
func fakeIDToken(payloadJSON string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(payloadJSON))
	return header + "." + payload + ".sig"
}

// TestWhoamiCmd_Success checks that whoami prints identity fields from the cached token.
func TestWhoamiCmd_Success(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	token := fakeIDToken(`{
		"iss": "https://localhost:34444/realms/master",
		"aud": "athenzd",
		"preferred_username": "idjag-learner",
		"email": "idjag-learner@athenz.io"
	}`)
	// Add a margin past 2h so int(d.Hours()) floors cleanly to 2, not 1.
	if err := cache.Save("idjag-learner", cache.TokenEntry{
		IDToken:   token,
		ExpiresAt: time.Now().Add(2*time.Hour + time.Minute),
	}); err != nil {
		t.Fatal(err)
	}

	cfg := writeTempConfig(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
current_service: idjag-learner
services:
  - name: idjag-learner
    athenz:
      domain: home.mlajkim
      provider: sys.auth.zts
    idp:
      issuer: https://localhost:34444/realms/master
      client_id: athenzd
`)
	cmd := newRootCmd()
	buf := &bytes.Buffer{}
	cmd.SetOut(buf)
	cmd.SetArgs([]string{"whoami", "-f", cfg})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	out := buf.String()
	for _, want := range []string{
		"idjag-learner",
		"https://localhost:34444/realms/master",
		"athenzd",
		"idjag-learner@athenz.io",
		"~2h left",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("expected output to contain %q, got:\n%s", want, out)
		}
	}
}

// TestWhoamiCmd_NoEmail checks that the email line is omitted when the claim is absent.
func TestWhoamiCmd_NoEmail(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	token := fakeIDToken(`{"preferred_username": "idjag-learner", "aud": "athenzd"}`)
	if err := cache.Save("idjag-learner", cache.TokenEntry{
		IDToken:   token,
		ExpiresAt: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	cfg := writeTempConfig(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
current_service: idjag-learner
services:
  - name: idjag-learner
    athenz:
      domain: home.mlajkim
      provider: sys.auth.zts
    idp:
      issuer: https://localhost:34444/realms/master
      client_id: athenzd
`)
	cmd := newRootCmd()
	buf := &bytes.Buffer{}
	cmd.SetOut(buf)
	cmd.SetArgs([]string{"whoami", "-f", cfg})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Contains(buf.String(), "email:") {
		t.Errorf("expected no email line, got:\n%s", buf.String())
	}
}

// TestWhoamiCmd_ResolveError checks that whoami fails when HOME is unset and no -f flag.
func TestWhoamiCmd_ResolveError(t *testing.T) {
	t.Setenv("HOME", "")
	cmd := newRootCmd()
	cmd.SetArgs([]string{"whoami"})
	if err := cmd.Execute(); err == nil {
		t.Fatal("expected error when HOME is unset, got nil")
	}
}

// TestWhoamiCmd_LoadError checks that whoami fails when the config file is missing.
func TestWhoamiCmd_LoadError(t *testing.T) {
	cmd := newRootCmd()
	cmd.SetArgs([]string{"whoami", "-f", "/tmp/no-such-athenzd-whoami.yaml"})
	if err := cmd.Execute(); err == nil {
		t.Fatal("expected error for missing config, got nil")
	}
}

// TestWhoamiCmd_MissingCurrentService checks that whoami fails when current_service is unset.
func TestWhoamiCmd_MissingCurrentService(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	cfg := writeTempConfig(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
services:
  - name: idjag-learner
    athenz:
      domain: home.mlajkim
      provider: sys.auth.zts
    idp:
      issuer: https://localhost:34444/realms/master
      client_id: athenzd
`)
	cmd := newRootCmd()
	cmd.SetArgs([]string{"whoami", "-f", cfg})
	if err := cmd.Execute(); err == nil {
		t.Fatal("expected error for missing current_service, got nil")
	}
}

// TestWhoamiCmd_NoToken checks that whoami fails when no token is cached.
func TestWhoamiCmd_NoToken(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	cfg := writeTempConfig(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
current_service: idjag-learner
services:
  - name: idjag-learner
    athenz:
      domain: home.mlajkim
      provider: sys.auth.zts
    idp:
      issuer: https://localhost:34444/realms/master
      client_id: athenzd
`)
	cmd := newRootCmd()
	cmd.SetArgs([]string{"whoami", "-f", cfg})
	if err := cmd.Execute(); err == nil {
		t.Fatal("expected error for missing cached token, got nil")
	}
}

// TestWhoamiCmd_BadToken checks that whoami fails when the cached token is malformed.
func TestWhoamiCmd_BadToken(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	if err := cache.Save("idjag-learner", cache.TokenEntry{
		IDToken:   "not-a-valid-jwt",
		ExpiresAt: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	cfg := writeTempConfig(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
current_service: idjag-learner
services:
  - name: idjag-learner
    athenz:
      domain: home.mlajkim
      provider: sys.auth.zts
    idp:
      issuer: https://localhost:34444/realms/master
      client_id: athenzd
`)
	cmd := newRootCmd()
	cmd.SetArgs([]string{"whoami", "-f", cfg})
	if err := cmd.Execute(); err == nil {
		t.Fatal("expected error for malformed cached token, got nil")
	}
}
