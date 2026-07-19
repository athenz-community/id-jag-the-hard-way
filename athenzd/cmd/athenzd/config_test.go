package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeTemp writes content to a temp yaml file and returns its path.
func writeTemp(t *testing.T, content string) string {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "athenzd-*.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString(content); err != nil {
		t.Fatal(err)
	}
	f.Close()
	return f.Name()
}

// TestConfigValidate_Valid checks that a valid config prints OK.
func TestConfigValidate_Valid(t *testing.T) {
	path := writeTemp(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
services:
  - name: my-service
    athenz:
      service: home.mlajkim.local.athenzd
      provider: cloud.ynw.identityd
    idp:
      issuer: https://localhost:34444/realms/master
      client_id: athenzd
    identity:
      mode: copperargos
      instance_id: workstation
      cert_file: /tmp/service.cert.pem
      key_file: /tmp/service.key.pem
      ca_file: /tmp/ca.cert.pem
`)
	cmd := newRootCmd()
	buf := &bytes.Buffer{}
	cmd.SetOut(buf)
	cmd.SetArgs([]string{"config", "validate", "-f", path})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	out := buf.String()
	if !strings.HasPrefix(out, "OK") {
		t.Errorf("expected OK output, got: %q", out)
	}
	if !strings.Contains(out, "zts:") {
		t.Errorf("expected zts in output, got: %q", out)
	}
	if !strings.Contains(out, "my-service") {
		t.Errorf("expected service name in output, got: %q", out)
	}
	if !strings.Contains(out, "home.mlajkim") {
		t.Errorf("expected domain in output, got: %q", out)
	}
	if !strings.Contains(out, "identity: copperargos") || !strings.Contains(out, "instance: workstation") {
		t.Errorf("expected identity enrollment config in output, got: %q", out)
	}
}

// TestConfigValidate_InvalidFile checks that a missing file returns an error.
func TestConfigValidate_InvalidFile(t *testing.T) {
	cmd := newRootCmd()
	cmd.SetArgs([]string{"config", "validate", "-f", filepath.Join(t.TempDir(), "no-such-file.yaml")})

	if err := cmd.Execute(); err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

// TestConfigValidate_MissingZTS checks that a config without athenz.zts returns an error.
func TestConfigValidate_MissingZTS(t *testing.T) {
	path := writeTemp(t, `
services:
  - name: my-service
    athenz:
      service: home.mlajkim.local.athenzd
      provider: cloud.ynw.identityd
`)
	cmd := newRootCmd()
	cmd.SetArgs([]string{"config", "validate", "-f", path})

	if err := cmd.Execute(); err == nil {
		t.Fatal("expected error for missing athenz.zts, got nil")
	}
}

// TestConfigValidate_ResolveError checks that validate fails when HOME is unset and no -f flag.
func TestConfigValidate_ResolveError(t *testing.T) {
	t.Setenv("HOME", "")
	cmd := newRootCmd()
	cmd.SetArgs([]string{"config", "validate"})
	if err := cmd.Execute(); err == nil {
		t.Fatal("expected error when HOME is unset and no -f flag, got nil")
	}
}

// TestConfigValidate_ShowsSource checks that validate prints the config source to stderr.
func TestConfigValidate_ShowsSource(t *testing.T) {
	path := writeTemp(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
services:
  - name: my-service
    athenz:
      service: home.mlajkim.local.athenzd
      provider: cloud.ynw.identityd
    idp:
      issuer: https://localhost:34444/realms/master
      client_id: athenzd
`)
	cmd := newRootCmd()
	errBuf := &bytes.Buffer{}
	cmd.SetErr(errBuf)
	cmd.SetArgs([]string{"config", "validate", "-f", path})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(errBuf.String(), "explicit (-f flag)") {
		t.Errorf("expected source in stderr, got: %q", errBuf.String())
	}
}

// TestConfigCurrent_Explicit checks that current-config prints the path and source for an explicit -f flag.
func TestConfigCurrent_Explicit(t *testing.T) {
	path := writeTemp(t, "")
	cmd := newRootCmd()
	buf := &bytes.Buffer{}
	cmd.SetOut(buf)
	cmd.SetArgs([]string{"config", "current-config", "-f", path})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, path) {
		t.Errorf("expected path %q in output, got: %q", path, out)
	}
	if !strings.Contains(out, "explicit (-f flag)") {
		t.Errorf("expected source in output, got: %q", out)
	}
}

// TestConfigCurrent_UserLevel checks that current-config resolves to ~/.athenzd/config.yaml when no project config.
func TestConfigCurrent_UserLevel(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	cmd := newRootCmd()
	buf := &bytes.Buffer{}
	cmd.SetOut(buf)
	cmd.SetArgs([]string{"config", "current-config"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, ".athenzd/config.yaml") {
		t.Errorf("expected .athenzd/config.yaml in output, got: %q", out)
	}
	if !strings.Contains(out, "user-level") {
		t.Errorf("expected user-level source in output, got: %q", out)
	}
}

// TestConfigCurrent_ResolveError checks that current-config fails when HOME is unset.
func TestConfigCurrent_ResolveError(t *testing.T) {
	t.Setenv("HOME", "")
	cmd := newRootCmd()
	cmd.SetArgs([]string{"config", "current-config"})
	if err := cmd.Execute(); err == nil {
		t.Fatal("expected error when HOME is unset, got nil")
	}
}
