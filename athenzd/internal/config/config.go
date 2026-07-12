package config

import (
	"fmt"

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
	ZTS string `mapstructure:"zts"`
	ZMS string `mapstructure:"zms"`
}

type ServiceConfig struct {
	Name   string        `mapstructure:"name"`
	Athenz ServiceAthenz `mapstructure:"athenz"`

	// Uncommented in PR 3 (x509 identity):
	// Identity IdentityConfig `mapstructure:"identity"`

	// Uncommented in PR 5 (role cert):
	// RoleCert RoleCertConfig `mapstructure:"role_cert"`

	// Uncommented in PR 4 (token):
	// Token TokenConfig `mapstructure:"token"`
}

type ServiceAthenz struct {
	Domain   string `mapstructure:"domain"`
	Provider string `mapstructure:"provider"`
}

// Load reads the config file at path and returns a validated Config.
func Load(path string) (*Config, error) {
	v := viper.New()
	v.SetConfigFile(path)

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
	for i, svc := range cfg.Services {
		if svc.Name == "" {
			return fmt.Errorf("services[%d].name is required", i)
		}
		if svc.Athenz.Domain == "" {
			return fmt.Errorf("services[%d] (%s): athenz.domain is required", i, svc.Name)
		}
		if svc.Athenz.Provider == "" {
			return fmt.Errorf("services[%d] (%s): athenz.provider is required", i, svc.Name)
		}
	}
	return nil
}
