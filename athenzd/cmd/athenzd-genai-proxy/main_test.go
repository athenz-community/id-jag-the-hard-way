package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/genaiproxy"
)

func TestRun(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	expiresAt := time.Now().Add(time.Hour)
	if err := cache.Save("idjag-learner", cache.TokenEntry{AccessToken: &cache.AccessTokenEntry{Token: "cached-at", ExpiresAt: expiresAt}}); err != nil {
		t.Fatal(err)
	}
	path := writeConfig(t, `
athenz:
  zts: https://zts.example.test/zts/v1
current_service: idjag-learner
gen_ai:
  domain: gen-ai.services.{{project}}
  role: gen-ai-users
  proxy: {}
`)
	var output bytes.Buffer
	err := run(context.Background(), []string{"--file", path}, &output, func(_ context.Context, options genaiproxy.Options) error {
		if options.Port != 65443 || options.UpstreamURL != "http://127.0.0.1:64443" || options.Output != &output {
			t.Fatalf("unexpected options: %+v", options)
		}
		token, err := options.TokenSource()
		if err != nil || token.Token != "cached-at" || !token.ExpiresAt.Equal(expiresAt) {
			t.Fatalf("token=%+v err=%v", token, err)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestRunErrors(t *testing.T) {
	server := func(context.Context, genaiproxy.Options) error { return errors.New("serve failed") }
	tests := []struct {
		name   string
		args   []string
		config string
		want   string
	}{
		{"invalid flag", []string{"--unknown"}, "", "parsing daemon arguments"},
		{"positional argument", []string{"unexpected"}, "", "no positional arguments"},
		{"disabled", nil, "athenz:\n  zts: https://zts.example.test\n", "gen_ai.proxy"},
		{"missing service", nil, "athenz:\n  zts: https://zts.example.test\ngen_ai:\n  domain: gen-ai.services.{{project}}\n  role: gen-ai-users\n  proxy: {}\n", "current_service"},
		{"server", nil, "athenz:\n  zts: https://zts.example.test\ncurrent_service: user\ngen_ai:\n  domain: gen-ai.services.{{project}}\n  role: gen-ai-users\n  proxy: {}\n", "serve failed"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			args := test.args
			if test.config != "" {
				args = append([]string{"-f", writeConfig(t, test.config)}, args...)
			}
			if err := run(context.Background(), args, &bytes.Buffer{}, server); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q, got %v", test.want, err)
			}
		})
	}
	if err := run(context.Background(), []string{"-f", filepath.Join(t.TempDir(), "missing.yaml")}, &bytes.Buffer{}, server); err == nil {
		t.Fatal("expected config load error")
	}
	t.Run("resolve", func(t *testing.T) {
		t.Setenv("HOME", "")
		t.Chdir(t.TempDir())
		if err := run(context.Background(), nil, &bytes.Buffer{}, server); err == nil {
			t.Fatal("expected config resolve error")
		}
	})
}

func TestCachedTokenSource(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	source := cachedTokenSource("service")
	if _, err := source(); err == nil {
		t.Fatal("expected missing cache error")
	}
	if err := cache.Save("service", cache.TokenEntry{}); err != nil {
		t.Fatal(err)
	}
	if token, err := source(); err != nil || token != nil {
		t.Fatalf("token=%+v err=%v", token, err)
	}
	expiresAt := time.Now().Add(time.Hour)
	if err := cache.Save("service", cache.TokenEntry{AccessToken: &cache.AccessTokenEntry{Token: "at", ExpiresAt: expiresAt}}); err != nil {
		t.Fatal(err)
	}
	token, err := source()
	if err != nil || token.Token != "at" || !token.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("token=%+v err=%v", token, err)
	}
}

func writeConfig(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}
