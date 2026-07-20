package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
	"github.com/AthenZ/athenzd/internal/genaiproxy"
)

func TestEnsureConfiguredGenAIProxyDisabled(t *testing.T) {
	runs := 0
	err := ensureConfiguredGenAIProxy(context.Background(), &config.Config{}, "/config", &cache.TokenEntry{}, &bytes.Buffer{},
		func(context.Context, genaiproxy.DaemonOptions) (*genaiproxy.DaemonResult, error) {
			runs++
			return nil, nil
		})
	if err != nil || runs != 0 {
		t.Fatalf("err=%v runs=%d", err, runs)
	}
}

func TestEnsureConfiguredGenAIProxyRequiresAccessToken(t *testing.T) {
	cfg := proxyTestConfig()
	for _, entry := range []*cache.TokenEntry{{}, {AccessToken: &cache.AccessTokenEntry{}}} {
		err := ensureConfiguredGenAIProxy(context.Background(), cfg, "/config", entry, &bytes.Buffer{},
			func(context.Context, genaiproxy.DaemonOptions) (*genaiproxy.DaemonResult, error) { return nil, nil })
		if err == nil || !strings.Contains(err.Error(), "no default GenAI access token") {
			t.Fatalf("unexpected error: %v", err)
		}
	}
}

func TestEnsureConfiguredGenAIProxyStartsOrReusesDaemon(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	entry := &cache.TokenEntry{AccessToken: &cache.AccessTokenEntry{Token: "active-at"}}
	for _, alreadyRunning := range []bool{false, true} {
		var output bytes.Buffer
		err := ensureConfiguredGenAIProxy(context.Background(), proxyTestConfig(), "/config.yaml", entry, &output,
			func(_ context.Context, options genaiproxy.DaemonOptions) (*genaiproxy.DaemonResult, error) {
				if options.Port != 65443 || options.UpstreamURL != "http://127.0.0.1:64443" || options.ConfigPath != "/config.yaml" ||
					options.InstanceID != genaiproxy.InstanceID("/config.yaml") || options.LogPath != "/genai-proxy.log" || options.StatePath != "/genai-proxy-state.json" {
					t.Fatalf("unexpected options: %+v", options)
				}
				return &genaiproxy.DaemonResult{PID: 4321, AlreadyRunning: alreadyRunning, LogPath: options.LogPath}, nil
			})
		wanted := "started on port"
		if alreadyRunning {
			wanted = "already running"
		}
		hasPID := strings.Contains(output.String(), "PID 4321")
		if err != nil || !strings.Contains(output.String(), wanted) || !strings.Contains(output.String(), "host.docker.internal:65443") || hasPID == alreadyRunning {
			t.Fatalf("running=%v err=%v output=%q", alreadyRunning, err, output.String())
		}
	}
}

func TestEnsureConfiguredGenAIProxyErrors(t *testing.T) {
	entry := &cache.TokenEntry{AccessToken: &cache.AccessTokenEntry{Token: "active-at"}}
	err := ensureConfiguredGenAIProxy(context.Background(), proxyTestConfig(), "/config", entry, &bytes.Buffer{},
		func(context.Context, genaiproxy.DaemonOptions) (*genaiproxy.DaemonResult, error) {
			return nil, errors.New("manager failed")
		})
	if err == nil || !strings.Contains(err.Error(), "ensuring") {
		t.Fatalf("expected manager error, got %v", err)
	}
}

func TestGenAIProxyDaemonPaths(t *testing.T) {
	logPath, statePath := genAIProxyDaemonPaths("/workspace/project/.athenzd/config.yaml")
	if logPath != "/workspace/project/.athenzd/genai-proxy.log" || statePath != "/workspace/project/.athenzd/genai-proxy-state.json" {
		t.Fatalf("log=%s state=%s", logPath, statePath)
	}
}

func proxyTestConfig() *config.Config {
	return &config.Config{GenAI: config.GenAIConfig{Proxy: &config.GenAIProxyConfig{
		Port:        65443,
		UpstreamURL: "http://127.0.0.1:64443",
	}}}
}
