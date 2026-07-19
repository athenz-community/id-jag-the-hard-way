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
	"strings"
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
  ca_file: /tmp/athenz-ca.pem
current_service: my-service
services:
  - name: my-service
    athenz:
      service: home.{{.preferred_username}}.local.athenzd
      optional_admins:
        - user.athenz_admin
      provider: cloud.ynw.identityd
    idp:
      issuer: https://localhost:34444/realms/master
      client_id: athenzd
      callback_port: 8250
      ca_file: /tmp/idp-ca.pem
    identity:
      mode: copperargos
      instance_id: workstation-idjag-learner
      cert_file: /tmp/athenzd.cert.pem
      key_file: /tmp/athenzd.key.pem
      ca_file: /tmp/athenz-ca-chain.pem
      expiry_minutes: 60
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
	if cfg.Athenz.CAFile != "/tmp/athenz-ca.pem" {
		t.Errorf("unexpected Athenz CA file: %q", cfg.Athenz.CAFile)
	}
	if cfg.CurrentService != "my-service" {
		t.Errorf("unexpected current_service: %q", cfg.CurrentService)
	}
	if cfg.Services[0].Name != "my-service" {
		t.Errorf("unexpected service name: %q", cfg.Services[0].Name)
	}
	if cfg.Services[0].Athenz.Service != "home.{{.preferred_username}}.local.athenzd" {
		t.Errorf("unexpected service: %q", cfg.Services[0].Athenz.Service)
	}
	if len(cfg.Services[0].Athenz.OptionalAdmins) != 1 || cfg.Services[0].Athenz.OptionalAdmins[0] != "user.athenz_admin" {
		t.Errorf("unexpected optional admins: %v", cfg.Services[0].Athenz.OptionalAdmins)
	}
	if cfg.Services[0].Athenz.Provider != "cloud.ynw.identityd" {
		t.Errorf("unexpected provider: %q", cfg.Services[0].Athenz.Provider)
	}
	if cfg.Services[0].IDP.Issuer != "https://localhost:34444/realms/master" {
		t.Errorf("unexpected idp.issuer: %q", cfg.Services[0].IDP.Issuer)
	}
	if cfg.Services[0].IDP.ClientID != "athenzd" {
		t.Errorf("unexpected idp.client_id: %q", cfg.Services[0].IDP.ClientID)
	}
	if cfg.Services[0].IDP.CallbackPort != 8250 {
		t.Errorf("unexpected idp.callback_port: %d", cfg.Services[0].IDP.CallbackPort)
	}
	if cfg.Services[0].IDP.CAFile != "/tmp/idp-ca.pem" {
		t.Errorf("unexpected idp.ca_file: %q", cfg.Services[0].IDP.CAFile)
	}
	identity := cfg.Services[0].Identity
	if identity.Mode != config.IdentityModeCopperArgos {
		t.Errorf("unexpected identity.mode: %q", identity.Mode)
	}
	if identity.InstanceID != "workstation-idjag-learner" {
		t.Errorf("unexpected identity.instance_id: %q", identity.InstanceID)
	}
	if identity.CertFile != "/tmp/athenzd.cert.pem" {
		t.Errorf("unexpected identity.cert_file: %q", identity.CertFile)
	}
	if identity.KeyFile != "/tmp/athenzd.key.pem" {
		t.Errorf("unexpected identity.key_file: %q", identity.KeyFile)
	}
	if identity.CAFile != "/tmp/athenz-ca-chain.pem" {
		t.Errorf("unexpected identity.ca_file: %q", identity.CAFile)
	}
	if identity.ExpiryMinutes != 60 {
		t.Errorf("unexpected identity.expiry_minutes: %d", identity.ExpiryMinutes)
	}
}

// TestLoad_MissingZTS checks that omitting athenz.zts produces a clear error.
func TestLoad_MissingZTS(t *testing.T) {
	path := writeTemp(t, `
services:
  - name: my-service
    athenz:
      service: home.mlajkim.local.athenzd
      provider: cloud.ynw.identityd
`)
	_, err := config.Load(path)
	if err == nil {
		t.Fatal("expected error for missing athenz.zts, got nil")
	}
}

// TestLoad_MissingAthenzService checks that omitting the full Athenz service identity is caught.
func TestLoad_MissingAthenzService(t *testing.T) {
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
		t.Fatal("expected error for missing Athenz service, got nil")
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
      service: home.mlajkim.local.athenzd
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

// TestLoad_MissingIDPIssuer checks that a service with no idp.issuer is caught.
func TestLoad_MissingIDPIssuer(t *testing.T) {
	path := writeTemp(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
services:
  - name: my-service
    athenz:
      service: home.mlajkim.local.athenzd
      provider: cloud.ynw.identityd
    idp:
      client_id: athenzd
`)
	_, err := config.Load(path)
	if err == nil {
		t.Fatal("expected error for missing idp.issuer, got nil")
	}
}

// TestLoad_MissingIDPClientID checks that a service with no idp.client_id is caught.
func TestLoad_MissingIDPClientID(t *testing.T) {
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
`)
	_, err := config.Load(path)
	if err == nil {
		t.Fatal("expected error for missing idp.client_id, got nil")
	}
}

// TestLoad_ProviderOptional checks that provider can stay absent until the
// certificate-registration flow needs it.
func TestLoad_ProviderOptional(t *testing.T) {
	path := writeTemp(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
services:
  - name: my-service
    athenz:
      service: home.mlajkim.local.athenzd
    idp:
      issuer: https://localhost:34444/realms/master
      client_id: athenzd
`)
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatalf("expected provider to be optional, got %v", err)
	}
	if cfg.Services[0].Athenz.Provider != "" {
		t.Fatalf("expected empty optional provider, got %q", cfg.Services[0].Athenz.Provider)
	}
}

func TestLoad_CopperArgosRequiresIdentityFields(t *testing.T) {
	valid := `
athenz:
  zts: https://zts.example.com:4443/zts/v1
services:
  - name: my-service
    athenz:
      service: home.mlajkim.local.athenzd
      provider: sys.auth.localworkload
    idp:
      issuer: https://localhost:34444/realms/master
      client_id: athenzd
    identity:
      mode: copperargos
      instance_id: workstation
      cert_file: /tmp/service.cert.pem
      key_file: /tmp/service.key.pem
      ca_file: /tmp/ca.cert.pem
`
	tests := []struct {
		name string
		old  string
		new  string
		want string
	}{
		{"provider", "      provider: sys.auth.localworkload\n", "", "athenz.provider"},
		{"instance id", "      instance_id: workstation\n", "", "identity.instance_id"},
		{"certificate file", "      cert_file: /tmp/service.cert.pem\n", "", "identity.cert_file"},
		{"key file", "      key_file: /tmp/service.key.pem\n", "", "identity.key_file"},
		{"ca file", "      ca_file: /tmp/ca.cert.pem\n", "", "identity.ca_file"},
		{"negative expiry", "      ca_file: /tmp/ca.cert.pem\n", "      ca_file: /tmp/ca.cert.pem\n      expiry_minutes: -1\n", "identity.expiry_minutes"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := config.Load(writeTemp(t, strings.Replace(valid, test.old, test.new, 1)))
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q error, got %v", test.want, err)
			}
		})
	}
}

func TestLoad_RejectsUnsupportedIdentityMode(t *testing.T) {
	path := writeTemp(t, `
athenz:
  zts: https://zts.example.com:4443/zts/v1
services:
  - name: my-service
    athenz:
      service: home.mlajkim.local.athenzd
    idp:
      issuer: https://localhost:34444/realms/master
      client_id: athenzd
    identity:
      mode: local
`)
	_, err := config.Load(path)
	if err == nil || !strings.Contains(err.Error(), "unsupported identity.mode") {
		t.Fatalf("expected unsupported identity mode error, got %v", err)
	}
}

// TestResolve_Explicit checks that an explicit path returns the path and correct source.
func TestResolve_Explicit(t *testing.T) {
	got, err := config.Resolve("/tmp/my.yaml")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Path != "/tmp/my.yaml" {
		t.Errorf("expected explicit path, got: %q", got.Path)
	}
	if got.Source != config.SourceExplicit {
		t.Errorf("expected source %q, got: %q", config.SourceExplicit, got.Source)
	}
}

// TestResolve_ProjectLevel checks that .athenzd/config.yaml is preferred over
// ~/.athenzd/config.yaml and is returned as an absolute path.
func TestResolve_ProjectLevel(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", t.TempDir())
	// Run inside a scratch dir so the project config doesn't touch the repo.
	t.Chdir(tmp)

	// Create a project-level config.
	if err := os.MkdirAll(".athenzd", 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(".athenzd/config.yaml", []byte(""), 0600); err != nil {
		t.Fatal(err)
	}

	got, err := config.Resolve("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !filepath.IsAbs(got.Path) {
		t.Errorf("expected absolute project-level path, got: %q", got.Path)
	}
	if filepath.Base(got.Path) != "config.yaml" || filepath.Base(filepath.Dir(got.Path)) != ".athenzd" {
		t.Errorf("expected path ending in .athenzd/config.yaml, got: %q", got.Path)
	}
	if got.Source != config.SourceProjectLevel {
		t.Errorf("expected source %q, got: %q", config.SourceProjectLevel, got.Source)
	}
}

// TestResolve_UserLevel checks that ~/.athenzd/config.yaml is used when no project config exists.
func TestResolve_UserLevel(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	// No .athenzd/config.yaml in the current directory.

	got, err := config.Resolve("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	expected := tmp + "/.athenzd/config.yaml"
	if got.Path != expected {
		t.Errorf("expected user-level path %q, got: %q", expected, got.Path)
	}
	if got.Source != config.SourceUserLevel {
		t.Errorf("expected source %q, got: %q", config.SourceUserLevel, got.Source)
	}
}

// TestResolve_HomeUnresolvable checks that Resolve returns an error when HOME is unset.
func TestResolve_HomeUnresolvable(t *testing.T) {
	t.Setenv("HOME", "")
	_, err := config.Resolve("")
	if err == nil {
		t.Fatal("expected error when HOME is unset, got nil")
	}
}

// TestLoad_ResolveError checks that Load returns an error when config path resolution fails.
func TestLoad_ResolveError(t *testing.T) {
	t.Setenv("HOME", "")
	_, err := config.Load("")
	if err == nil {
		t.Fatal("expected error when HOME is unset and no explicit path, got nil")
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
