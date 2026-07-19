package cache

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type TokenEntry struct {
	IDToken     string                `json:"id_token"`
	ExpiresAt   time.Time             `json:"expires_at"`
	IDJAGs      map[string]IDJAGEntry `json:"id_jags,omitempty"`
	AccessToken *AccessTokenEntry     `json:"access_token,omitempty"`
}

// IDJAGEntry is the identity assertion issued to the local X.509 workload for
// all eligible roles in one discovered GenAI service-project domain.
type IDJAGEntry struct {
	Service   string    `json:"service"`
	Domain    string    `json:"domain"`
	Token     string    `json:"token"`
	Scope     string    `json:"scope"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (e *TokenEntry) IsExpired() bool {
	return time.Now().After(e.ExpiresAt)
}

func cacheDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolving home dir: %w", err)
	}
	d := filepath.Join(home, ".cache", "athenzd")
	if err := os.MkdirAll(d, 0700); err != nil {
		return "", fmt.Errorf("creating cache dir: %w", err)
	}
	return d, nil
}

// PathFor returns the cache file path for the given service.
// Exported so tests can inspect or pre-populate the cache file.
func PathFor(service string) (string, error) {
	d, err := cacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, service+".json"), nil
}

// Save writes a TokenEntry for the given service to disk.
func Save(service string, entry TokenEntry) error {
	p, err := PathFor(service)
	if err != nil {
		return err
	}
	return writeFile(p, entry)
}

func writeFile(p string, entry TokenEntry) error {
	data, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling token: %w", err)
	}
	// 0600 — owner read/write only; tokens are sensitive.
	return os.WriteFile(p, data, 0600)
}

// Load reads the cached TokenEntry for the given service.
// Returns an error if the file does not exist or cannot be parsed.
func Load(service string) (*TokenEntry, error) {
	p, err := PathFor(service)
	if err != nil {
		return nil, err
	}
	return readFile(p)
}

func readFile(p string) (*TokenEntry, error) {
	data, err := os.ReadFile(p)
	if err != nil {
		return nil, fmt.Errorf("reading cache: %w", err)
	}
	var entry TokenEntry
	if err := json.Unmarshal(data, &entry); err != nil {
		return nil, fmt.Errorf("parsing cache: %w", err)
	}
	return &entry, nil
}
