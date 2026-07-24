package genaiproxy

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestEnsureDaemonAlreadyRunningWithRealProbe(t *testing.T) {
	handler, err := NewHandler("http://127.0.0.1:64443", func() (*AccessToken, error) { return nil, nil })
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	port := serverPort(t, server.URL)

	result, err := EnsureDaemon(context.Background(), DaemonOptions{
		Port: port, UpstreamURL: "http://127.0.0.1:64443", LogPath: "/tmp/proxy.log",
	})
	if err != nil || !result.AlreadyRunning || result.LogPath != "/tmp/proxy.log" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func TestEnsureDaemonLaunchesWithDefaultDependencies(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	originalLaunch := launchDaemonProcess
	originalDelay := daemonReadyDelay
	t.Cleanup(func() {
		launchDaemonProcess = originalLaunch
		daemonReadyDelay = originalDelay
	})
	daemonReadyDelay = 0
	var server *http.Server
	launchDaemonProcess = func(options DaemonOptions) (int, error) {
		handler, err := NewHandler(options.UpstreamURL, func() (*AccessToken, error) { return nil, nil })
		if err != nil {
			return 0, err
		}
		listener, err := net.Listen("tcp4", "127.0.0.1:"+strconv.Itoa(options.Port))
		if err != nil {
			return 0, err
		}
		server = &http.Server{Handler: handler}
		go func() { _ = server.Serve(listener) }()
		return 2468, nil
	}
	statePath := filepath.Join(t.TempDir(), "state.json")
	result, err := EnsureDaemon(context.Background(), DaemonOptions{
		Port: port, UpstreamURL: "http://127.0.0.1:64443", ConfigPath: "/config", LogPath: "/log", StatePath: statePath,
	})
	if server != nil {
		defer server.Close()
	}
	if err != nil || result.PID != 2468 {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if _, err := os.Stat(statePath); err != nil {
		t.Fatalf("state file: %v", err)
	}
}

func TestEnsureDaemonLaunchesAndRecordsState(t *testing.T) {
	probes := 0
	writes := 0
	now := time.Unix(123, 0)
	options := DaemonOptions{Port: 65443, UpstreamURL: "http://upstream", InstanceID: "project-1", ConfigPath: "/config", LogPath: "/log", StatePath: "/state"}
	result, err := ensureDaemon(context.Background(), options, daemonManagerDeps{
		probe: func(context.Context, int, string, string) (bool, error) {
			probes++
			return probes >= 3, nil
		},
		launch: func(got DaemonOptions) (int, error) {
			if got != options {
				t.Fatalf("options=%+v", got)
			}
			return 4321, nil
		},
		wait: func(context.Context) error { return nil },
		writeState: func(path string, state daemonState) error {
			writes++
			if path != "/state" || state.PID != 4321 || state.Port != 65443 || state.UpstreamURL != "http://upstream" || state.InstanceID != "project-1" || state.ConfigPath != "/config" || state.LogPath != "/log" || !state.StartedAt.Equal(now) {
				t.Fatalf("path=%s state=%+v", path, state)
			}
			return nil
		},
		now: nowTime(now), attempts: 3,
	})
	if err != nil || result.PID != 4321 || result.AlreadyRunning || result.LogPath != "/log" || writes != 1 {
		t.Fatalf("result=%+v writes=%d err=%v", result, writes, err)
	}
}

func TestEnsureDaemonIsIdempotent(t *testing.T) {
	running := false
	launches := 0
	stateWrites := 0
	options := DaemonOptions{Port: 65443, UpstreamURL: "http://upstream", InstanceID: "project-1", ConfigPath: "/config", LogPath: "/log", StatePath: "/state"}
	deps := daemonManagerDeps{
		probe: func(context.Context, int, string, string) (bool, error) { return running, nil },
		launch: func(DaemonOptions) (int, error) {
			launches++
			running = true
			return 4321, nil
		},
		wait: func(context.Context) error { return nil },
		writeState: func(string, daemonState) error {
			stateWrites++
			return nil
		},
		now: nowTime(time.Unix(123, 0)), attempts: 1,
	}

	first, err := ensureDaemon(context.Background(), options, deps)
	if err != nil || first.AlreadyRunning || first.PID != 4321 {
		t.Fatalf("first result=%+v err=%v", first, err)
	}
	second, err := ensureDaemon(context.Background(), options, deps)
	if err != nil || !second.AlreadyRunning {
		t.Fatalf("second result=%+v err=%v", second, err)
	}
	if launches != 1 || stateWrites != 1 {
		t.Fatalf("launches=%d state writes=%d", launches, stateWrites)
	}
}

func TestEnsureDaemonErrors(t *testing.T) {
	options := DaemonOptions{Port: 65443, LogPath: "/log", StatePath: "/state"}
	tests := []struct {
		name string
		deps daemonManagerDeps
		want string
	}{
		{"initial probe", daemonManagerDeps{probe: probeError("occupied")}, "occupied"},
		{"launch", daemonManagerDeps{probe: probeSequence(false), launch: func(DaemonOptions) (int, error) { return 0, errors.New("start failed") }}, "launching"},
		{"wait", daemonManagerDeps{probe: probeSequence(false), launch: launchPID(1), wait: func(context.Context) error { return errors.New("cancelled") }, attempts: 1}, "cancelled"},
		{"second probe", daemonManagerDeps{probe: probeSequence(false, false), launch: launchPID(1), wait: waitOK, attempts: 1}, "did not become ready"},
		{"poll probe", daemonManagerDeps{probe: probeAfterStartError(), launch: launchPID(1), wait: waitOK, attempts: 1}, "probe failed"},
		{"state", daemonManagerDeps{probe: probeSequence(false, true), launch: launchPID(1), wait: waitOK, writeState: func(string, daemonState) error { return errors.New("state failed") }, now: nowTime(time.Time{}), attempts: 1}, "recording"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ensureDaemon(context.Background(), options, test.deps)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected %q error, got %v", test.want, err)
			}
		})
	}
}

func TestProbeDaemonRejectsUnexpectedListeners(t *testing.T) {
	if running, err := probeDaemon(context.Background(), 1, "http://upstream", "project"); err != nil || running {
		t.Fatalf("running=%v err=%v", running, err)
	}
	for _, response := range []struct {
		name     string
		status   int
		body     string
		upstream string
		instance string
		want     string
	}{
		{"status", http.StatusInternalServerError, `{}`, "http://upstream", "project", "something other"},
		{"invalid", http.StatusOK, `{`, "http://upstream", "project", "something other"},
		{"service", http.StatusOK, `{"service":"other","status":"ok"}`, "http://upstream", "project", "something other"},
		{"upstream", http.StatusOK, `{"service":"athenzd-genai-proxy","status":"ok","upstream":"http://old","instance":"project"}`, "http://new", "project", "uses upstream"},
		{"project", http.StatusOK, `{"service":"athenzd-genai-proxy","status":"ok","upstream":"http://upstream","instance":"other"}`, "http://upstream", "project", "another project"},
	} {
		t.Run(response.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(response.status)
				_, _ = writer.Write([]byte(response.body))
			}))
			defer server.Close()
			_, err := probeDaemon(context.Background(), serverPort(t, server.URL), response.upstream, response.instance)
			if err == nil || !strings.Contains(err.Error(), response.want) {
				t.Fatalf("expected %q error, got %v", response.want, err)
			}
		})
	}
}

func TestWaitContext(t *testing.T) {
	if err := waitContext(context.Background(), 0); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := waitContext(ctx, time.Hour); !errors.Is(err, context.Canceled) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestWriteDaemonState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	state := daemonState{PID: 42, Port: 65443}
	if err := writeDaemonState(path, state); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(data), `"pid": 42`) {
		t.Fatalf("data=%q err=%v", data, err)
	}
	if err := writeDaemonState(t.TempDir(), state); err == nil {
		t.Fatal("expected write error")
	}

	original := marshalDaemonState
	t.Cleanup(func() { marshalDaemonState = original })
	marshalDaemonState = func(any, string, string) ([]byte, error) { return nil, errors.New("marshal failed") }
	if err := writeDaemonState(path, state); err == nil {
		t.Fatal("expected marshal error")
	}
}

func TestLaunchDaemonLogError(t *testing.T) {
	if _, err := launchDaemon(DaemonOptions{LogPath: filepath.Join(t.TempDir(), "missing", "proxy.log")}); err == nil {
		t.Fatal("expected log open error")
	}
}

func serverPort(t *testing.T, rawURL string) int {
	t.Helper()
	_, portValue, err := net.SplitHostPort(strings.TrimPrefix(rawURL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatal(err)
	}
	return port
}

func probeError(message string) func(context.Context, int, string, string) (bool, error) {
	return func(context.Context, int, string, string) (bool, error) { return false, errors.New(message) }
}

func probeSequence(values ...bool) func(context.Context, int, string, string) (bool, error) {
	index := 0
	return func(context.Context, int, string, string) (bool, error) {
		value := values[index]
		index++
		return value, nil
	}
}

func launchPID(pid int) func(DaemonOptions) (int, error) {
	return func(DaemonOptions) (int, error) { return pid, nil }
}

func waitOK(context.Context) error             { return nil }
func nowTime(value time.Time) func() time.Time { return func() time.Time { return value } }

func probeAfterStartError() func(context.Context, int, string, string) (bool, error) {
	calls := 0
	return func(context.Context, int, string, string) (bool, error) {
		calls++
		if calls == 1 {
			return false, nil
		}
		return false, errors.New("probe failed")
	}
}

func TestInstanceID(t *testing.T) {
	if InstanceID("/project-a/.athenzd/config.yaml") == InstanceID("/project-b/.athenzd/config.yaml") {
		t.Fatal("different project configs must have different instance IDs")
	}
	if InstanceID("/project-a/.athenzd/../.athenzd/config.yaml") != InstanceID("/project-a/.athenzd/config.yaml") {
		t.Fatal("equivalent cleaned paths must have the same instance ID")
	}
	if InstanceID("/project-a/.athenzd/alternate.yaml") != InstanceID("/project-a/.athenzd/config.yaml") {
		t.Fatal("configs in the same directory must have the same instance ID")
	}
}
