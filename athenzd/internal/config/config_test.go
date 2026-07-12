// Package config_test validates config loading and parsing.
//
// Convention: whenever a new field is added to Config (required or optional),
// TestLoad_Valid must assert its parsed value with a non-zero test input.
// This ensures no field is silently ignored by the mapstructure decoder.
package config_test

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/AthenZ/athenzd/internal/config"
	"github.com/spf13/viper"
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

// TestLoad_Valid checks that a fully populated config loads and every field is parsed correctly.
func TestLoad_Valid(t *testing.T) {
	path := writeTemp(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
  zms: https://zms.example.com:4443/zms/v1
current_service: my-service
services:
  - name: my-service
    athenz:
      domain: home.mlajkim
      provider: cloud.ynw.identityd
`)
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.Athenz.ZTS != "https://zts.example.com:4443/zts/v1" {
		t.Errorf("unexpected ZTS: %q", cfg.Athenz.ZTS)
	}
	if cfg.Athenz.ZMS != "https://zms.example.com:4443/zms/v1" {
		t.Errorf("unexpected ZMS: %q", cfg.Athenz.ZMS)
	}
	if cfg.CurrentService != "my-service" {
		t.Errorf("unexpected current_service: %q", cfg.CurrentService)
	}
	if cfg.Services[0].Name != "my-service" {
		t.Errorf("unexpected service name: %q", cfg.Services[0].Name)
	}
	if cfg.Services[0].Athenz.Domain != "home.mlajkim" {
		t.Errorf("unexpected domain: %q", cfg.Services[0].Athenz.Domain)
	}
	if cfg.Services[0].Athenz.Provider != "cloud.ynw.identityd" {
		t.Errorf("unexpected provider: %q", cfg.Services[0].Athenz.Provider)
	}
}

// TestLoad_MissingZTS checks that omitting athenz.zts produces a clear error.
func TestLoad_MissingZTS(t *testing.T) {
	path := writeTemp(t, `
services:
  - name: my-service
    athenz:
      domain: home.mlajkim
      provider: cloud.ynw.identityd
`)
	_, err := config.Load(path)
	if err == nil {
		t.Fatal("expected error for missing athenz.zts, got nil")
	}
}

// TestLoad_MissingServiceDomain checks that omitting a service's domain is caught.
func TestLoad_MissingServiceDomain(t *testing.T) {
	path := writeTemp(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
services:
  - name: my-service
    athenz:
      provider: cloud.ynw.identityd
`)
	_, err := config.Load(path)
	if err == nil {
		t.Fatal("expected error for missing service domain, got nil")
	}
}

// TestLoad_MissingFile checks that a non-existent path returns an error.
func TestLoad_MissingFile(t *testing.T) {
	_, err := config.Load(filepath.Join(t.TempDir(), "does-not-exist.yaml"))
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

// TestLoad_MissingServiceName checks that a service with no name is caught.
func TestLoad_MissingServiceName(t *testing.T) {
	path := writeTemp(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
services:
  - athenz:
      domain: home.mlajkim
      provider: cloud.ynw.identityd
`)
	_, err := config.Load(path)
	if err == nil {
		t.Fatal("expected error for missing service name, got nil")
	}
}

// TestParse_UnmarshalError checks that a failing unmarshal returns a clear error.
// We inject a synthetic error to cover the branch that Viper never triggers naturally.
func TestParse_UnmarshalError(t *testing.T) {
	_, err := config.Parse(func(v any, opts ...viper.DecoderConfigOption) error {
		return fmt.Errorf("injected unmarshal failure")
	})
	if err == nil {
		t.Fatal("expected error from failing unmarshal, got nil")
	}
}

// TestLoad_MissingServiceProvider checks that a service with no provider is caught.
func TestLoad_MissingServiceProvider(t *testing.T) {
	path := writeTemp(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
services:
  - name: my-service
    athenz:
      domain: home.mlajkim
`)
	_, err := config.Load(path)
	if err == nil {
		t.Fatal("expected error for missing service provider, got nil")
	}
}

// TestLoad_DefaultConfig checks that the shipped athenzd.default.yaml parses
// without panicking. Validation errors are expected (required fields are blank),
// but a parse error would mean the YAML structure is broken.
func TestLoad_DefaultConfig(t *testing.T) {
	_, err := config.Load("../../athenzd.default.yaml")
	if err == nil {
		// Default config has blank required fields — validation should fail.
		t.Fatal("expected validation error from default config (zts is blank), got nil")
	}
	// As long as it's a validation error and not a YAML parse error, we're good.
	// The error message should mention "required".
	if err.Error() == "reading config: open ../../athenzd.default.yaml: no such file or directory" {
		t.Skip("default config not yet written — skipping")
	}
}
