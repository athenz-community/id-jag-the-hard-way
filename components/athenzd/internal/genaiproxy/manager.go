package genaiproxy

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

type DaemonOptions struct {
	Port        int
	UpstreamURL string
	InstanceID  string
	ConfigPath  string
	LogPath     string
	StatePath   string
}

type DaemonResult struct {
	PID            int
	AlreadyRunning bool
	LogPath        string
}

type daemonHealth struct {
	Service  string `json:"service"`
	Status   string `json:"status"`
	Upstream string `json:"upstream"`
	Instance string `json:"instance"`
}

type daemonState struct {
	PID         int       `json:"pid"`
	Port        int       `json:"port"`
	UpstreamURL string    `json:"upstream_url"`
	InstanceID  string    `json:"instance_id"`
	ConfigPath  string    `json:"config_path"`
	LogPath     string    `json:"log_path"`
	StartedAt   time.Time `json:"started_at"`
}

type daemonManagerDeps struct {
	probe      func(context.Context, int, string, string) (bool, error)
	launch     func(DaemonOptions) (int, error)
	wait       func(context.Context) error
	writeState func(string, daemonState) error
	now        func() time.Time
	attempts   int
}

var marshalDaemonState = json.MarshalIndent
var launchDaemonProcess = launchDaemon
var daemonReadyDelay = 100 * time.Millisecond

func EnsureDaemon(ctx context.Context, options DaemonOptions) (*DaemonResult, error) {
	return ensureDaemon(ctx, options, daemonManagerDeps{
		probe:      probeDaemon,
		launch:     launchDaemonProcess,
		wait:       func(ctx context.Context) error { return waitContext(ctx, daemonReadyDelay) },
		writeState: writeDaemonState,
		now:        time.Now,
		attempts:   50,
	})
}

func ensureDaemon(ctx context.Context, options DaemonOptions, deps daemonManagerDeps) (*DaemonResult, error) {
	running, err := deps.probe(ctx, options.Port, options.UpstreamURL, options.InstanceID)
	if err != nil {
		return nil, err
	}
	if running {
		return &DaemonResult{AlreadyRunning: true, LogPath: options.LogPath}, nil
	}

	pid, err := deps.launch(options)
	if err != nil {
		return nil, fmt.Errorf("launching athenzd GenAI proxy daemon: %w", err)
	}
	for attempt := 0; attempt < deps.attempts; attempt++ {
		if err := deps.wait(ctx); err != nil {
			return nil, err
		}
		running, err = deps.probe(ctx, options.Port, options.UpstreamURL, options.InstanceID)
		if err != nil {
			return nil, err
		}
		if running {
			state := daemonState{
				PID:         pid,
				Port:        options.Port,
				UpstreamURL: options.UpstreamURL,
				InstanceID:  options.InstanceID,
				ConfigPath:  options.ConfigPath,
				LogPath:     options.LogPath,
				StartedAt:   deps.now(),
			}
			if err := deps.writeState(options.StatePath, state); err != nil {
				return nil, fmt.Errorf("recording athenzd GenAI proxy daemon: %w", err)
			}
			return &DaemonResult{PID: pid, LogPath: options.LogPath}, nil
		}
	}
	return nil, fmt.Errorf("athenzd GenAI proxy daemon did not become ready on port %d; inspect %s", options.Port, options.LogPath)
}

func probeDaemon(ctx context.Context, port int, expectedUpstream, expectedInstance string) (bool, error) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("http://127.0.0.1:%d/healthz", port), nil)
	client := &http.Client{Timeout: 500 * time.Millisecond}
	response, err := client.Do(request)
	if err != nil {
		return false, nil
	}
	defer response.Body.Close()
	var health daemonHealth
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&health) != nil ||
		health.Service != "athenzd-genai-proxy" || health.Status != "ok" {
		return false, fmt.Errorf("port %d is already in use by something other than the athenzd GenAI proxy", port)
	}
	if health.Upstream != expectedUpstream {
		return false, fmt.Errorf("athenzd GenAI proxy on port %d uses upstream %s, expected %s", port, health.Upstream, expectedUpstream)
	}
	if health.Instance != expectedInstance {
		return false, fmt.Errorf("athenzd GenAI proxy on port %d belongs to another project directory", port)
	}
	return true, nil
}

// InstanceID identifies the directory-level daemon without exposing its local
// directory through the unauthenticated health endpoint.
func InstanceID(configPath string) string {
	directory := filepath.Dir(filepath.Clean(configPath))
	digest := sha256.Sum256([]byte(directory))
	return fmt.Sprintf("%x", digest[:8])
}

func waitContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func writeDaemonState(path string, state daemonState) error {
	encoded, err := marshalDaemonState(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, encoded, 0600)
}
