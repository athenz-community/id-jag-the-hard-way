package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/viper"
)

type Config struct {
	Athenz         AthenzCore      `mapstructure:"athenz"`
	CurrentService string          `mapstructure:"current_service"`
	Services       []ServiceConfig `mapstructure:"services"`

	// Uncommented in PR 7 (proxy):
	// Proxy ProxyConfig `mapstructure:"proxy"`

	// Uncommented in PR 9 (healthz):
	// Healthz HealthzConfig `mapstructure:"healthz"`
}

type AthenzCore struct {
	ZTS    string `mapstructure:"zts"`
	ZMS    string `mapstructure:"zms"`
	CAFile string `mapstructure:"ca_file"`
}

type ServiceConfig struct {
	Name   string        `mapstructure:"name"`
	Athenz ServiceAthenz `mapstructure:"athenz"`
	IDP    IDPConfig     `mapstructure:"idp"`

	// Uncommented in PR 4 (x509 identity):
	// Identity IdentityConfig `mapstructure:"identity"`

	// Uncommented in PR 6 (role cert):
	// RoleCert RoleCertConfig `mapstructure:"role_cert"`

	// Uncommented in PR 5 (token):
	// Token TokenConfig `mapstructure:"token"`
}

type IDPConfig struct {
	Issuer       string `mapstructure:"issuer"`
	ClientID     string `mapstructure:"client_id"`
	CallbackPort int    `mapstructure:"callback_port"`
	// CAFile trusts a custom CA for the IdP HTTPS connection (e.g. the Athenz
	// tutorial CA that signs the local Keycloak HTTPS cert). Empty = system trust.
	CAFile string `mapstructure:"ca_file"`
}

type ServiceAthenz struct {
	Service        string   `mapstructure:"service"`
	OptionalAdmins []string `mapstructure:"optional_admins"`
	Provider       string   `mapstructure:"provider"`
}

type ResolveSource string

const (
	SourceExplicit     ResolveSource = "explicit (-f flag)"
	SourceProjectLevel ResolveSource = "project-level, overrides ~/.athenzd default"
	SourceUserLevel    ResolveSource = "user-level (default)"
)

type ResolveResult struct {
	Path   string
	Source ResolveSource
}

// getwd is a seam so tests can exercise the (rare) working-directory error path.
var getwd = os.Getwd

// Resolve returns the config file path to use, in priority order:
//  1. explicit path (non-empty)
//  2. ./.athenzd/config.yaml  (project-level)
//  3. ~/.athenzd/config.yaml  (user-level)
//
// The returned Path is always absolute so callers can print it unambiguously.
func Resolve(explicit string) (*ResolveResult, error) {
	if explicit != "" {
		return &ResolveResult{Path: explicit, Source: SourceExplicit}, nil
	}
	if _, err := os.Stat(".athenzd/config.yaml"); err == nil {
		cwd, err := getwd()
		if err != nil {
			return nil, fmt.Errorf("resolving working dir: %w", err)
		}
		return &ResolveResult{
			Path:   filepath.Join(cwd, ".athenzd", "config.yaml"),
			Source: SourceProjectLevel,
		}, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("resolving home dir: %w", err)
	}
	return &ResolveResult{
		Path:   filepath.Join(home, ".athenzd", "config.yaml"),
		Source: SourceUserLevel,
	}, nil
}

// Load resolves the config path and loads the config file.
// Use Resolve + LoadResolved directly when you need the ResolveResult (e.g. to log the source).
func Load(path string) (*Config, error) {
	r, err := Resolve(path)
	if err != nil {
		return nil, err
	}
	return LoadResolved(r)
}

// LoadResolved loads the config file at the path in r.
func LoadResolved(r *ResolveResult) (*Config, error) {
	v := viper.New()
	v.SetConfigFile(r.Path)

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("reading config: %w", err)
	}

	return loadFromViper(v)
}

// loadFromViper unmarshals and validates from an already-read Viper instance.
// Extracted so tests can inject a pre-populated Viper without touching the filesystem.
func loadFromViper(v *viper.Viper) (*Config, error) {
	return Parse(v.Unmarshal)
}

// Parse runs unmarshalFn into a Config and validates it.
// Exported so tests can inject a failing unmarshal to cover the error branch.
func Parse(unmarshalFn func(any, ...viper.DecoderConfigOption) error) (*Config, error) {
	var cfg Config
	if err := unmarshalFn(&cfg); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}

	if err := validate(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func validate(cfg *Config) error {
	if cfg.Athenz.ZTS == "" {
		return fmt.Errorf("athenz.zts is required")
	}
	for i := range cfg.Services {
		svc := &cfg.Services[i]
		if svc.Name == "" {
			return fmt.Errorf("services[%d].name is required", i)
		}
		if svc.Athenz.Service == "" {
			return fmt.Errorf("services[%d] (%s): athenz.service is required", i, svc.Name)
		}
		if svc.IDP.Issuer == "" {
			return fmt.Errorf("services[%d] (%s): idp.issuer is required", i, svc.Name)
		}
		if svc.IDP.ClientID == "" {
			return fmt.Errorf("services[%d] (%s): idp.client_id is required", i, svc.Name)
		}
	}
	return nil
}
