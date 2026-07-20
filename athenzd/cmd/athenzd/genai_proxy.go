package main

import (
	"context"
	"fmt"
	"io"
	"path/filepath"

	"github.com/AthenZ/athenzd/internal/cache"
	"github.com/AthenZ/athenzd/internal/config"
	"github.com/AthenZ/athenzd/internal/genaiproxy"
)

type genAIProxyManager func(context.Context, genaiproxy.DaemonOptions) (*genaiproxy.DaemonResult, error)

func ensureConfiguredGenAIProxy(ctx context.Context, cfg *config.Config, configPath string,
	entry *cache.TokenEntry, output io.Writer, manager genAIProxyManager) error {
	if cfg.GenAI.Proxy == nil {
		return nil
	}
	if entry.AccessToken == nil || entry.AccessToken.Token == "" {
		return fmt.Errorf("gen_ai.proxy is configured but no default GenAI access token was issued")
	}
	logPath, statePath := genAIProxyDaemonPaths(configPath)
	result, err := manager(ctx, genaiproxy.DaemonOptions{
		Port:        cfg.GenAI.Proxy.Port,
		UpstreamURL: cfg.GenAI.Proxy.UpstreamURL,
		InstanceID:  genaiproxy.InstanceID(configPath),
		ConfigPath:  configPath,
		LogPath:     logPath,
		StatePath:   statePath,
	})
	if err != nil {
		return fmt.Errorf("ensuring athenzd GenAI proxy daemon: %w", err)
	}
	if result.AlreadyRunning {
		fmt.Fprintf(output, "✓ athenzd GenAI proxy daemon already running on port %d\n", cfg.GenAI.Proxy.Port)
	} else {
		fmt.Fprintf(output, "✓ athenzd GenAI proxy daemon started on port %d (PID %d)\n", cfg.GenAI.Proxy.Port, result.PID)
	}
	fmt.Fprintf(output, "  Open WebUI: http://host.docker.internal:%d (Auth disabled)\n", cfg.GenAI.Proxy.Port)
	fmt.Fprintf(output, "  Upstream: %s\n", cfg.GenAI.Proxy.UpstreamURL)
	fmt.Fprintf(output, "  Project config: %s\n", configPath)
	fmt.Fprintf(output, "  Log: %s\n", result.LogPath)
	return nil
}

func genAIProxyDaemonPaths(configPath string) (string, string) {
	directory := filepath.Dir(configPath)
	return filepath.Join(directory, "genai-proxy.log"),
		filepath.Join(directory, "genai-proxy-state.json")
}
