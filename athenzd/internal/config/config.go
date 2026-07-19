package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/AthenZ/athenzd/internal/genai"
	"github.com/spf13/viper"
)

type Config struct {
	Athenz         AthenzCore      `mapstructure:"athenz"`
	CurrentService string          `mapstructure:"current_service"`
	GenAI          GenAIConfig     `mapstructure:"gen_ai"`
	Services       []ServiceConfig `mapstructure:"services"`

	// Uncommented in PR 7 (proxy):
	// Proxy ProxyConfig `mapstructure:"proxy"`

	// Uncommented in PR 9 (healthz):
	// Healthz HealthzConfig `mapstructure:"healthz"`
}

// GenAIConfig defines how service-project memberships are recognized. Empty
// values keep ID-JAG issuance disabled for backward compatibility.
type GenAIConfig struct {
	Domain         string `mapstructure:"domain"`
	Role           string `mapstructure:"role"`
	DefaultProject string `mapstructure:"default_project"`
}

type AthenzCore struct {
	ZTS    string `mapstructure:"zts"`
	ZMS    string `mapstructure:"zms"`
	CAFile string `mapstructure:"ca_file"`
}

type ServiceConfig struct {
	Name     string         `mapstructure:"name"`
	Athenz   ServiceAthenz  `mapstructure:"athenz"`
	IDP      IDPConfig      `mapstructure:"idp"`
	Identity IdentityConfig `mapstructure:"identity"`

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

const IdentityModeCopperArgos = "copperargos"

// IdentityConfig controls opt-in X.509 service identity enrollment. The
// provider belongs to the Athenz service configuration because it is part of
// the Athenz authorization relationship, while these fields are local output
// and certificate-request settings.
type IdentityConfig struct {
	Mode          string `mapstructure:"mode"`
	InstanceID    string `mapstructure:"instance_id"`
	CertFile      string `mapstructure:"cert_file"`
	KeyFile       string `mapstructure:"key_file"`
	CAFile        string `mapstructure:"ca_file"`
	ExpiryMinutes int    `mapstructure:"expiry_minutes"`
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
	if cfg.GenAI.Domain != "" || cfg.GenAI.Role != "" || cfg.GenAI.DefaultProject != "" {
		if cfg.GenAI.Domain == "" {
			return fmt.Errorf("gen_ai.domain is required when another gen_ai setting is set")
		}
		if cfg.GenAI.Role == "" {
			return fmt.Errorf("gen_ai.role is required when another gen_ai setting is set")
		}
		if _, err := genai.ParseDomainTemplate(cfg.GenAI.Domain); err != nil {
			return fmt.Errorf("gen_ai.domain: %w", err)
		}
		if err := genai.ValidateRole(cfg.GenAI.Role); err != nil {
			return fmt.Errorf("gen_ai.role: %w", err)
		}
		if cfg.GenAI.DefaultProject != "" {
			if err := genai.ValidateService(cfg.GenAI.DefaultProject); err != nil {
				return fmt.Errorf("gen_ai.default_project: %w", err)
			}
		}
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
		switch svc.Identity.Mode {
		case "":
		case IdentityModeCopperArgos:
			if svc.Athenz.Provider == "" {
				return fmt.Errorf("services[%d] (%s): athenz.provider is required when identity.mode=%s", i, svc.Name, IdentityModeCopperArgos)
			}
			if svc.Identity.InstanceID == "" {
				return fmt.Errorf("services[%d] (%s): identity.instance_id is required when identity.mode=%s", i, svc.Name, IdentityModeCopperArgos)
			}
			if svc.Identity.CertFile == "" {
				return fmt.Errorf("services[%d] (%s): identity.cert_file is required when identity.mode=%s", i, svc.Name, IdentityModeCopperArgos)
			}
			if svc.Identity.KeyFile == "" {
				return fmt.Errorf("services[%d] (%s): identity.key_file is required when identity.mode=%s", i, svc.Name, IdentityModeCopperArgos)
			}
			if svc.Identity.CAFile == "" {
				return fmt.Errorf("services[%d] (%s): identity.ca_file is required when identity.mode=%s", i, svc.Name, IdentityModeCopperArgos)
			}
			if svc.Identity.ExpiryMinutes < 0 {
				return fmt.Errorf("services[%d] (%s): identity.expiry_minutes must not be negative", i, svc.Name)
			}
		default:
			return fmt.Errorf("services[%d] (%s): unsupported identity.mode %q", i, svc.Name, svc.Identity.Mode)
		}
	}
	return nil
}
