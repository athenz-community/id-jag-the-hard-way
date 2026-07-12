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
      domain: home.mlajkim
      provider: cloud.ynw.identityd
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
      domain: home.mlajkim
      provider: cloud.ynw.identityd
`)
	cmd := newRootCmd()
	cmd.SetArgs([]string{"config", "validate", "-f", path})

	if err := cmd.Execute(); err == nil {
		t.Fatal("expected error for missing athenz.zts, got nil")
	}
}
